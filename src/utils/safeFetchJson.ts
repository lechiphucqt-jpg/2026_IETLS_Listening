export function extractErrorMessage(err: unknown, fallback = 'Lỗi máy chủ không xác định.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') {
    const trimmed = err.trim();
    if (trimmed === '[object Object]' || !trimmed) return fallback;
    return trimmed;
  }
  if (err instanceof Error) {
    const msg = err.message?.trim();
    if (msg && msg !== '[object Object]') return msg;
    return fallback;
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.trim() && obj.message !== '[object Object]') {
      return obj.message.trim();
    }
    if (typeof obj.error === 'string' && obj.error.trim() && obj.error !== '[object Object]') {
      return obj.error.trim();
    }
    if (obj.error && typeof obj.error === 'object') {
      return extractErrorMessage(obj.error, fallback);
    }
    if (typeof obj.details === 'string' && obj.details.trim()) {
      return obj.details.trim();
    }
    try {
      const str = JSON.stringify(err);
      if (str && str !== '{}') return str;
    } catch {
      // fallback
    }
  }
  return fallback;
}

export async function safeParseJsonResponse<T extends { error?: unknown; message?: unknown }>(
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
        'Cổng kết nối trả về trang HTML thay vì dữ liệu JSON (có thể do hết phiên hoặc đường dẫn API chưa được cấu hình). Vui lòng kiểm tra lại kết nối.'
      );
    }
    throw new Error(
      res.ok
        ? `${fallbackError} (Định dạng phản hồi không phải JSON hợp lệ)`
        : `Máy chủ trả về lỗi HTTP ${res.status}. Vui lòng thử lại với tệp nhỏ hơn hoặc kiểm tra kết nối.`
    );
  }

  if (!res.ok) {
    const msg = extractErrorMessage(
      parsed.error || (parsed as Record<string, unknown>).message,
      `Máy chủ trả về lỗi HTTP ${res.status}.`
    );
    throw new Error(msg);
  }

  return parsed;
}
