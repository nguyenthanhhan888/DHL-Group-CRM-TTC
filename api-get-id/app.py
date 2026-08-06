from flask import Flask, jsonify, render_template, request
import requests

app = Flask(__name__)

API_URL = "https://id.traodoisub.com/api.php"

HEADERS = {
    "accept": "*/*",
    "content-type": "application/x-www-form-urlencoded",
    "origin": "https://id.traodoisub.com",
    "referer": "https://id.traodoisub.com/",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/148.0.0.0 Safari/537.36"
    ),
}


@app.get("/")
def home():
    return render_template("index.html")


@app.post("/api/get-id")
def get_facebook_id():
    data = request.get_json(silent=True) or {}
    facebook_url = str(data.get("url", "")).strip()

    if not facebook_url:
        return jsonify({
            "success": False,
            "error": "Vui lòng nhập URL Facebook."
        }), 400

    try:
        response = requests.post(
            API_URL,
            data={"link": facebook_url},
            headers=HEADERS,
            timeout=15,
        )

        response.raise_for_status()
        result = response.json()

        facebook_id = result.get("id")

        if facebook_id:
            return jsonify({
                "success": True,
                "id": str(facebook_id),
                "url": facebook_url,
            })

        return jsonify({
            "success": False,
            "error": result.get("error", "Không tìm thấy Facebook ID.")
        }), 400

    except requests.exceptions.JSONDecodeError:
        return jsonify({
            "success": False,
            "error": "API trả về dữ liệu không hợp lệ."
        }), 502

    except requests.exceptions.Timeout:
        return jsonify({
            "success": False,
            "error": "API phản hồi quá chậm. Vui lòng thử lại."
        }), 504

    except requests.exceptions.RequestException as error:
        return jsonify({
            "success": False,
            "error": f"Không thể kết nối tới API: {error}"
        }), 502


if __name__ == "__main__":
    app.run(debug=True, port=5000)