export async function safeParseJsonResponse<T extends { error?: string }>(
  res: Response,
  fallbackError = 'Không thể xử lý phản hồi từ máy chủ.'
): Promise<T> {
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    throw new Error(
      res.ok
        ? 'Máy chủ đóng kết nối trước khi trả dữ liệu (phản hồi trống). Vui lòng thử lại.'
        : `Máy chủ trả về lỗi HTTP ${res.status} với phản hồi trống. Vui lòng thử lại.`
    );
  }

  let parsed: T;
  try {
    parsed = JSON.parse(trimmed) as T;
  } catch {
    if (trimmed.startsWith('<') || /<!doctype html|<html/i.test(trimmed)) {
      throw new Error(
        'Cổng kết nối trả về trang HTML thay vì dữ liệu JSON (có thể do hết phiên đăng nhập hoặc quá thời gian chờ). Vui lòng tải lại trang (F5) và thử lại.'
      );
    }
    throw new Error(
      res.ok
        ? `${fallbackError} (Định dạng phản hồi không phải JSON hợp lệ)`
        : `Máy chủ trả về lỗi HTTP ${res.status}. Vui lòng thử lại với tệp nhỏ hơn hoặc kiểm tra kết nối.`
    );
  }

  if (!res.ok) {
    throw new Error(parsed.error || `Máy chủ trả về lỗi HTTP ${res.status}.`);
  }

  return parsed;
}
