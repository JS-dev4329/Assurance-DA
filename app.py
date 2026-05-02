from flask import Flask, render_template, request, jsonify
import yfinance as yf
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

app = Flask(__name__)


def calculate_stock_metrics(ticker: str, reference_date: str):
    ref_date = datetime.strptime(reference_date, "%Y-%m-%d")
    start_date = ref_date - timedelta(days=400)  # 여유있게 400일 조회
    end_date = ref_date + timedelta(days=1)

    stock = yf.Ticker(ticker)
    hist = stock.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"))

    if hist.empty:
        raise ValueError(f"'{ticker}' 종목의 데이터를 찾을 수 없습니다.")

    # 조회 기준일 이전 거래일 데이터만 사용 (최근 252 거래일 = 약 1년)
    hist = hist[hist.index <= pd.Timestamp(ref_date, tz=hist.index.tz)]

    if len(hist) < 2:
        raise ValueError("데이터가 충분하지 않습니다. 기준일을 조정해주세요.")

    # 최근 252 거래일 (1년치)
    hist_1y = hist.tail(252)

    prices = hist_1y["Close"].round(4)
    dates = [d.strftime("%Y-%m-%d") for d in hist_1y.index]

    # 단순 주가 수익률: (P_t - P_{t-1}) / P_{t-1}
    simple_returns = prices.pct_change().dropna()

    # 연속복리 주가수익률: ln(P_t / P_{t-1})
    log_returns = np.log(prices / prices.shift(1)).dropna()

    # 주가수익률 변동의 표준편차 (일별 로그수익률 기준)
    daily_std = float(log_returns.std())

    # 연간변동성: 일별 표준편차 × sqrt(252)
    annual_volatility = daily_std * np.sqrt(252)

    # 연간 단순 총수익률
    annual_simple_return = float((prices.iloc[-1] / prices.iloc[0]) - 1)

    # 연간 연속복리 총수익률
    annual_log_return = float(np.log(prices.iloc[-1] / prices.iloc[0]))

    result = {
        "ticker": ticker.upper(),
        "reference_date": reference_date,
        "company_name": stock.info.get("longName", ticker.upper()),
        "currency": stock.info.get("currency", "USD"),
        "data_points": len(prices),
        "start_date": dates[0],
        "end_date": dates[-1],
        "summary": {
            "start_price": round(float(prices.iloc[0]), 4),
            "end_price": round(float(prices.iloc[-1]), 4),
            "annual_simple_return": round(annual_simple_return * 100, 4),
            "annual_log_return": round(annual_log_return * 100, 4),
            "daily_std": round(daily_std * 100, 4),
            "annual_volatility": round(annual_volatility * 100, 4),
        },
        "chart_data": {
            "dates": dates,
            "prices": [round(float(p), 4) for p in prices],
            "simple_returns": [round(float(r) * 100, 4) for r in simple_returns],
            "log_returns": [round(float(r) * 100, 4) for r in log_returns],
        },
    }
    return result


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.get_json()
    ticker = data.get("ticker", "").strip()
    reference_date = data.get("reference_date", "").strip()

    if not ticker:
        return jsonify({"error": "종목 코드를 입력해주세요."}), 400
    if not reference_date:
        return jsonify({"error": "기준일자를 입력해주세요."}), 400

    try:
        result = calculate_stock_metrics(ticker, reference_date)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"데이터 조회 중 오류가 발생했습니다: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
