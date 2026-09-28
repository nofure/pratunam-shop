// Last-resort guard: a crash inside one page shows a retry screen instead of a blank app.
// Pages keep their own boundaries; this one catches whatever they don't (Layout keys it by the
// top-level section, so moving to another section clears it).
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button, EmptyState } from './ui'

interface State {
  failed: boolean
}

export default class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[app] page crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page">
        <EmptyState
          icon={<TriangleAlert size={28} />}
          title="หน้านี้เปิดไม่สำเร็จ"
          hint="ข้อมูลที่บันทึกไว้ยังอยู่ครบ ลองอีกครั้ง ถ้ายังไม่ได้ให้โหลดหน้าใหม่"
          action={
            <div className="row">
              <Button variant="primary" onClick={() => this.setState({ failed: false })}>
                ลองอีกครั้ง
              </Button>
              <Button onClick={() => window.location.reload()}>โหลดหน้าใหม่</Button>
            </div>
          }
        />
      </div>
    )
  }
}
