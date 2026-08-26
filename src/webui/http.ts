/**
 * @description 面板到宿主接口的唯一取数出口
 *
 * 抽出来的理由是它已经被绕过一次并因此丢了行为：选择器（PickerModal）自己裸 fetch + res.json()，
 * 于是宿主 session 过期时用户看到的是 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`，
 * 而同一时刻整包轮询那条路弹的是「未登录或无权限」—— 同一个面板对同一件事两套说法，
 * 而且前者把用户指向「接口坏了」而不是「去重新登录」。
 *
 * 注意：`res.json()` 必须包在 try 里且**排在 res.ok 判断之前** —— 鉴权失败时宿主回的是 HTML
 * 登录页而不是 JSON，先 json() 会抛 SyntaxError、状态码根本读不到。
 * 注意：错误信封 `{ ok: false, error }` 是服务端通用形状（webadapter 的 guard 统一产出），
 * 类型写在这里而不是各调用点就地 cast —— 改名或加字段时只有一处要动
 */

/** 服务端 guard 出错时回的形状，与任何成功回包都不同形 */
interface ErrorEnvelope {
  ok?: boolean
  error?: string
}

/**
 * @description 发一个请求并把回包解析成 T；失败一律抛 Error（消息是能直接显示给用户的中文）
 * @param base 接口前缀，宿主可能挂在 /qqbot-web 这类路径下（见 main.tsx 的 WEB_BASE）
 * @param path 接口路径，如 `/config`
 * @param body 给了就是 POST
 */
export async function request<T>(base: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  let data: unknown
  try {
    data = await res.json()
  } catch {
    // 鉴权失败时宿主回的是 HTML 登录页，不是 JSON
    throw new Error(
      res.status === 401 || res.status === 403 ? "未登录或无权限" : `HTTP ${res.status}`,
    )
  }

  const envelope = data as ErrorEnvelope
  if (!res.ok || envelope.ok === false) throw new Error(envelope.error || `HTTP ${res.status}`)
  return data as T
}

/** catch 到的是 unknown，统一取一句能显示的话 */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
