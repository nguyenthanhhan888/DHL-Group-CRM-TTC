import os
import time
import requests

# Cấu hình API và Headers chuẩn
API_URL = "https://id.traodoisub.com/api.php"
HEADERS = {
    "accept": "*/*",
    "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
    "content-type": "application/x-www-form-urlencoded",
    "origin": "https://id.traodoisub.com",
    "referer": "https://id.traodoisub.com/",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
}

INPUT_FILE = "link.txt"
OUTPUT_FILE = "id.txt"
DELAY_SECONDS = 10  # Khoảng cách giữa các lần gửi request để tránh bị block/spam

def get_fb_id(fb_url):
    """Gửi request lấy ID từ URL Facebook, tự động thử lại nếu thất bại."""
    payload = {"link": fb_url}
    while True:
        try:
            response = requests.post(API_URL, data=payload, headers=HEADERS, timeout=10)
            response.raise_for_status()  # Ném lỗi nếu mã trạng thái là 4xx hoặc 5xx
            data = response.json()
            if "id" in data and data["id"]:
                return data["id"]  # Trả về ID nếu thành công và thoát vòng lặp
            elif "error" in data:
                print(f"    -> Lỗi từ API: {data['error']}. Thử lại sau {DELAY_SECONDS} giây...")
            else:
                print(f"    -> Phản hồi không hợp lệ từ API. Thử lại sau {DELAY_SECONDS} giây...")
        except requests.exceptions.RequestException as e:
            print(f"    -> Lỗi kết nối hoặc timeout: {e}. Thử lại sau {DELAY_SECONDS} giây...")
        except requests.exceptions.JSONDecodeError:
            print(f"    -> Không thể đọc phản hồi từ server. Thử lại sau {DELAY_SECONDS} giây...")
        time.sleep(DELAY_SECONDS)

def main():
    # Kiểm tra file đầu vào
    if not os.path.exists(INPUT_FILE):
        print(f"[-] Không tìm thấy file '{INPUT_FILE}'. Vui lòng tạo file và thêm các link Facebook vào.")
        # Tạo file mẫu cho người dùng nếu chưa có
        with open(INPUT_FILE, "w", encoding="utf-8") as f:
            f.write("https://www.facebook.com/NTH204.vn\n")
            f.write("https://www.facebook.com/zuck\n")
        print(f"[+] Đã tạo tự động file mẫu '{INPUT_FILE}'. Vui lòng sửa lại link bên trong.")
        return

    # Đọc danh sách link
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip()]

    if not urls:
        print(f"[-] File '{INPUT_FILE}' đang trống. Hãy thêm link vào.")
        return

    print(f"[+] Tìm thấy {len(urls)} link cần xử lý.")
    print(f"[+] Kết quả sẽ được ghi liên tục vào file '{OUTPUT_FILE}'.")
    print("-" * 50)

    # Đọc để xử lý từng link
    for index, url in enumerate(urls):
        print(f"[{index + 1}/{len(urls)}] Đang check: {url}")
        
        uid = get_fb_id(url)
        
        # Ghi kết quả theo định dạng: url -> id vào file (append mode)
        with open(OUTPUT_FILE, "a", encoding="utf-8") as out_f:
            out_f.write(f"{uid}\n")
            print(f"    -> Đã ghi: {url} -> {uid}")

        # Nếu chưa phải link cuối cùng thì nghỉ 10s để tránh spam
        if index < len(urls) - 1:
            print(f"    -> Chờ {DELAY_SECONDS} giây trước link tiếp theo...")
            time.sleep(DELAY_SECONDS)

    print("-" * 50)
    print(f"[+] Hoàn thành! Toàn bộ kết quả đã được lưu tại '{OUTPUT_FILE}'.")

if __name__ == "__main__":
    main()