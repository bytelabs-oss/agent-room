import { Toaster } from "@/components/ui/sonner"
import { Page } from "@/page"
import { RoomProvider } from "@/room"
import { ThemeProvider, useTheme } from "@/theme"

function Toasts() {
  return <Toaster theme={useTheme().theme} position="bottom-right" />
}

export default function App() {
  return (
    <ThemeProvider>
      <RoomProvider>
        <div className="h-dvh overflow-hidden">
          <Page />
        </div>
        <Toasts />
      </RoomProvider>
    </ThemeProvider>
  )
}
