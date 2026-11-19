import { Component, StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

// 새 버전을 배포하면 예전 화면 조각(js) 파일이 사라진다 — 못 받으면 한 번만 새로 고쳐 새 버전을 받는다
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault()
  if (!sessionStorage.getItem("rulef5.reloaded")) { sessionStorage.setItem("rulef5.reloaded", "1"); location.reload() }
})
window.addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("rulef5.reloaded"), 5000))

// 화면 오류가 나도 흰 화면 대신 안내와 새로 고침 단추를 보여 준다(진행 중인 작업은 서버에 남아 이어받는다)
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div style={{ maxWidth: 560, margin: "15vh auto", padding: 24, fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>화면을 다시 불러와야 합니다</h1>
        <p style={{ color: "#555" }}>새 버전이 배포되었거나 일시적인 오류가 났습니다. 새로 고치면 진행 중이던 작업을 이어서 볼 수 있습니다.</p>
        <button onClick={() => location.reload()} style={{ marginTop: 12, padding: "8px 16px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" }}>새로 고침</button>
      </div>
    )
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </Boundary>
  </StrictMode>
)
