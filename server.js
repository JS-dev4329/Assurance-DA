const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const PORT = process.env.PORT || 3000;

function fetchYahooFinance(ticker, startTs, endTs) {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${startTs}&period2=${endTs}&events=history`;
    const options = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } };
    https.get(apiUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON 파싱 오류')); }
      });
    }).on('error', reject);
  });
}

function stdDev(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

async function analyzeStock(ticker, referenceDate, tradingDays = 252) {
  const days = Math.min(Math.max(parseInt(tradingDays) || 252, 2), 1260);
  const calendarBuffer = Math.ceil(days * 1.5) + 30;

  const refDate = new Date(referenceDate);
  const startDate = new Date(refDate);
  startDate.setDate(startDate.getDate() - calendarBuffer);

  const startTs = Math.floor(startDate.getTime() / 1000);
  const endTs = Math.floor(refDate.getTime() / 1000) + 86400;

  const raw = await fetchYahooFinance(ticker, startTs, endTs);
  const chart = raw?.chart?.result?.[0];
  if (!chart) {
    const errMsg = raw?.chart?.error?.description || '데이터를 찾을 수 없습니다.';
    throw new Error(`'${ticker}': ${errMsg}`);
  }

  const meta = chart.meta;
  const timestamps = chart.timestamp || [];
  const closes = chart.indicators?.quote?.[0]?.close || [];

  const pairs = timestamps
    .map((ts, i) => ({ date: new Date(ts * 1000), price: closes[i] }))
    .filter(p => p.price != null && !isNaN(p.price) && p.date <= refDate);

  if (pairs.length < 2) throw new Error('데이터가 충분하지 않습니다. 기준일을 조정해주세요.');
  if (pairs.length < days) throw new Error(`조회 가능한 거래일(${pairs.length}일)이 요청한 기간(${days}일)보다 짧습니다.`);

  const data = pairs.slice(-days);
  const prices = data.map(p => p.price);
  const dates = data.map(p => p.date.toISOString().split('T')[0]);

  const simpleReturns = [];
  const logReturns = [];
  for (let i = 1; i < prices.length; i++) {
    simpleReturns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }

  const dailyStd = stdDev(logReturns);
  const annualVol = dailyStd * Math.sqrt(252);
  const annualSimpleReturn = (prices[prices.length - 1] / prices[0]) - 1;
  const annualLogReturn = Math.log(prices[prices.length - 1] / prices[0]);

  return {
    ticker: ticker.toUpperCase(),
    reference_date: referenceDate,
    trading_days: days,
    company_name: meta.longName || meta.shortName || ticker.toUpperCase(),
    currency: meta.currency || 'USD',
    exchange: meta.exchangeName || '',
    data_points: prices.length,
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    summary: {
      start_price: +prices[0].toFixed(4),
      end_price: +prices[prices.length - 1].toFixed(4),
      annual_simple_return: +(annualSimpleReturn * 100).toFixed(4),
      annual_log_return: +(annualLogReturn * 100).toFixed(4),
      daily_std: +(dailyStd * 100).toFixed(4),
      annual_volatility: +(annualVol * 100).toFixed(4),
    },
    _raw: { prices, dates, simpleReturns, logReturns, dailyStd, annualVol },
    chart_data: {
      dates,
      prices: prices.map(p => +p.toFixed(4)),
      simple_returns: simpleReturns.map(r => +(r * 100).toFixed(4)),
      log_returns: logReturns.map(r => +(r * 100).toFixed(4)),
    },
  };
}

// ── 스타일 상수 ──
const C = {
  ORANGE:      'FFFFC000',  // Input/Output 라벨 배경 (원본 동일)
  GRAY_HDR:    'FFDBDBDB',  // 컬럼 헤더 배경 (원본 동일)
  DARK_GRAY:   'FF404040',  // 헤더 텍스트
  WHITE:       'FFFFFFFF',
  ROW_ALT:     'FFF5F5F5',  // 짝수 행 배경
  GREEN:       'FF00692B',  // 양수 수익률
  RED:         'FFC00000',  // 음수 수익률
  NEUTRAL:     'FF404040',  // 0 또는 std/vol
  BORDER_CLR:  'FFB0B0B0',
};

const THIN = (color = C.BORDER_CLR) => ({
  top:    { style: 'thin', color: { argb: color } },
  left:   { style: 'thin', color: { argb: color } },
  bottom: { style: 'thin', color: { argb: color } },
  right:  { style: 'thin', color: { argb: color } },
});
const MEDIUM = () => ({
  top:    { style: 'medium', color: { argb: 'FF808080' } },
  left:   { style: 'medium', color: { argb: 'FF808080' } },
  bottom: { style: 'medium', color: { argb: 'FF808080' } },
  right:  { style: 'medium', color: { argb: 'FF808080' } },
});

function sectionLabel(ws, rowNum, text, colCount) {
  const row = ws.getRow(rowNum);
  row.height = 20;
  ws.mergeCells(rowNum, 1, rowNum, colCount);
  const cell = row.getCell(1);
  cell.value = text;
  cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF000000' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.ORANGE } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  cell.border = MEDIUM();
}

function headerRow(ws, rowNum, labels, wrapText = false) {
  const row = ws.getRow(rowNum);
  row.height = wrapText ? 36 : 20;
  labels.forEach((label, i) => {
    const cell = row.getCell(i + 1);
    cell.value = label;
    cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: C.DARK_GRAY } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.GRAY_HDR } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText };
    cell.border = THIN();
  });
}

function inputValueRow(ws, rowNum, values) {
  const row = ws.getRow(rowNum);
  row.height = 18;
  values.forEach((val, i) => {
    const cell = row.getCell(i + 1);
    cell.value = val;
    cell.font = { name: 'Arial', size: 9, color: { argb: 'FF1F3864' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.WHITE } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = THIN();
  });
}

async function generateExcel(result) {
  const { ticker, reference_date, trading_days, company_name, currency, exchange,
          start_date, end_date, _raw } = result;
  const { prices, dates, simpleReturns, logReturns, dailyStd, annualVol } = _raw;
  const n = prices.length;
  const COLS = 7;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'US Stock Analyzer';
  wb.created = new Date();

  const ws = wb.addWorksheet(`변동성(${reference_date})`, {
    views: [{ state: 'frozen', ySplit: 9 }],  // 데이터 헤더 행 고정
  });

  // 열 너비 (원본 비율 참고)
  ws.columns = [
    { width: 6  },  // 구분
    { width: 13 },  // 일자
    { width: 14 },  // 주가
    { width: 20 },  // 단순 주가수익률
    { width: 22 },  // 연속복리 주가수익률
    { width: 28 },  // 주가수익률 변동의 표준편차
    { width: 16 },  // 연간변동성
  ];

  // ── Row 1: Input 라벨 ──
  sectionLabel(ws, 1, 'Input', COLS);

  // ── Row 2: 빈 행 ──
  ws.getRow(2).height = 6;

  // ── Row 3: Input 헤더 ──
  headerRow(ws, 3, ['조회기준', '조회기준일', '조회영업일수', '조회기간', '거래소', '조회대상', '회사명']);

  // ── Row 4: Input 값 ──
  inputValueRow(ws, 4, [
    '일자', reference_date, trading_days,
    `${start_date} ~ ${end_date}`,
    exchange, ticker, company_name,
  ]);
  // 조회영업일수: 숫자 가운데 정렬
  ws.getRow(4).getCell(3).numFmt = '#,##0';

  // ── Row 5: 빈 행 ──
  ws.getRow(5).height = 8;

  // ── Row 6: Output 라벨 ──
  sectionLabel(ws, 6, 'Output', COLS);

  // ── Row 7: 빈 행 ──
  ws.getRow(7).height = 6;

  // ── Row 8: Output 헤더 ──
  headerRow(ws, 8, [
    '구분', '일자', `주가(${currency})`,
    '단순 주가수익률', '연속복리 주가수익률',
    '주가수익률 변동의 표준편차', '연간변동성',
  ], true);

  // ── Row 9~: 데이터 ──
  const PCT_FMT   = '0.0000%';
  const PRICE_FMT = '#,##0.00';

  // 행 번호 계산
  // seq=1(최신) → Excel row 9,  seq=n(최고) → Excel row 8+n
  const DATA_START = 9;                 // 첫 데이터 행
  const LAST_DATA  = 8 + n;            // 마지막 데이터 행 (가장 오래된 주가, 수익률 없음)
  const LAST_RET   = LAST_DATA - 1;    // 수익률이 있는 마지막 행

  for (let i = n - 1; i >= 0; i--) {
    const seq = n - i;
    const R   = 8 + seq;   // 현재 Excel 행 번호

    const exRow = ws.getRow(R);
    exRow.height = 15;

    const rowBg = seq % 2 === 0 ? C.ROW_ALT : C.WHITE;
    const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    const baseFont = { name: 'Arial', size: 9 };

    // ① 구분
    const cSeq = exRow.getCell(1);
    cSeq.value = seq;
    cSeq.font = { ...baseFont, color: { argb: C.DARK_GRAY } };
    cSeq.fill = fill;
    cSeq.alignment = { horizontal: 'center', vertical: 'middle' };
    cSeq.border = THIN();

    // ② 일자 (원시값)
    const cDate = exRow.getCell(2);
    cDate.value = dates[i];
    cDate.font = { ...baseFont, color: { argb: C.DARK_GRAY } };
    cDate.fill = fill;
    cDate.alignment = { horizontal: 'center', vertical: 'middle' };
    cDate.border = THIN();

    // ③ 주가 (원시값 — Yahoo Finance 원본)
    const cPrice = exRow.getCell(3);
    cPrice.value = prices[i];
    cPrice.numFmt = PRICE_FMT;
    cPrice.font = { ...baseFont, color: { argb: 'FF00338A' } };
    cPrice.fill = fill;
    cPrice.alignment = { horizontal: 'right', vertical: 'middle' };
    cPrice.border = THIN();

    // ④ 단순 주가수익률: =(C_R - C_{R+1}) / C_{R+1}
    const cSR = exRow.getCell(4);
    if (R < LAST_DATA) {
      cSR.value = { formula: `(C${R}-C${R+1})/C${R+1}`, result: simpleReturns[i - 1] };
      cSR.numFmt = PCT_FMT;
      const srVal = simpleReturns[i - 1];
      const srColor = srVal > 0 ? C.GREEN : srVal < 0 ? C.RED : C.NEUTRAL;
      cSR.font = { ...baseFont, bold: Math.abs(srVal) > 0.02, color: { argb: srColor } };
    } else {
      cSR.font = { ...baseFont };
    }
    cSR.fill = fill;
    cSR.alignment = { horizontal: 'right', vertical: 'middle' };
    cSR.border = THIN();

    // ⑤ 연속복리 주가수익률: =LN(C_R / C_{R+1})
    const cLR = exRow.getCell(5);
    if (R < LAST_DATA) {
      cLR.value = { formula: `LN(C${R}/C${R+1})`, result: logReturns[i - 1] };
      cLR.numFmt = PCT_FMT;
      const lrVal = logReturns[i - 1];
      const lrColor = lrVal > 0 ? C.GREEN : lrVal < 0 ? C.RED : C.NEUTRAL;
      cLR.font = { ...baseFont, bold: Math.abs(lrVal) > 0.02, color: { argb: lrColor } };
    } else {
      cLR.font = { ...baseFont };
    }
    cLR.fill = fill;
    cLR.alignment = { horizontal: 'right', vertical: 'middle' };
    cLR.border = THIN();

    // ⑥ 주가수익률 변동의 표준편차: =STDEV(E9:E{LAST_RET})  — 첫 행만
    const cStd = exRow.getCell(6);
    if (seq === 1) {
      cStd.value = { formula: `STDEV(E${DATA_START}:E${LAST_RET})`, result: dailyStd };
      cStd.numFmt = PCT_FMT;
      cStd.font = { ...baseFont, bold: true, color: { argb: C.NEUTRAL } };
      cStd.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    } else {
      cStd.font = { ...baseFont };
      cStd.fill = fill;
    }
    cStd.alignment = { horizontal: 'right', vertical: 'middle' };
    cStd.border = THIN();

    // ⑦ 연간변동성: =F9*SQRT(252)  — 첫 행만
    const cVol = exRow.getCell(7);
    if (seq === 1) {
      cVol.value = { formula: `F${DATA_START}*SQRT(252)`, result: annualVol };
      cVol.numFmt = PCT_FMT;
      cVol.font = { ...baseFont, bold: true, color: { argb: C.NEUTRAL } };
      cVol.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    } else {
      cVol.font = { ...baseFont };
      cVol.fill = fill;
    }
    cVol.alignment = { horizontal: 'right', vertical: 'middle' };
    cVol.border = THIN();
  }

  return wb.xlsx.writeBuffer();
}

// ── HTTP 서버 ──
function createServer() {
  return http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname;

  function readBody(req) {
    return new Promise(resolve => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => resolve(body));
    });
  }

  if (pathname === '/api/analyze' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { ticker, reference_date, trading_days } = JSON.parse(body);
      if (!ticker)         { res.writeHead(400, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({ error: '종목 코드를 입력해주세요.' })); }
      if (!reference_date) { res.writeHead(400, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({ error: '기준일자를 입력해주세요.' })); }
      const result = await analyzeStock(ticker, reference_date, trading_days);
      const { _raw, ...safe } = result;
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(safe));
    } catch (e) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/export' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { ticker, reference_date, trading_days } = JSON.parse(body);
      if (!ticker || !reference_date) throw new Error('파라미터 오류');
      const result = await analyzeStock(ticker, reference_date, trading_days);
      const buf = await generateExcel(result);
      const filename = encodeURIComponent(`주가변동성_${ticker}_${reference_date}_${result.trading_days}일.xlsx`);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        'Content-Length': buf.length,
      });
      res.end(Buffer.from(buf));
    } catch (e) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    try {
      const content = fs.readFileSync(path.join(__dirname, 'templates', 'index.html'));
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(content);
    } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }

    res.writeHead(404);
    res.end('Not found');
  });
}

function startServer(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      resolve(port);
    });
  });
}

module.exports = { startServer };

// 직접 실행 시 (node server.js)
if (require.main === module) {
  startServer(PORT);
}
