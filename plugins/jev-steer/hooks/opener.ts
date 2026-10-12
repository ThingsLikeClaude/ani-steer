import type { ClientModule } from 'claude-code'

// The inventory at the right end of the strip, pressable: a click opens the
// ani pane. One text row, so the strip stays as low as its text.
const Opener: ClientModule<{ text: string }> = (props, s) => {
  if (s.state === undefined) {
    s.onPointer(ev => {
      if (ev.type === 'up' && ev.button === 'left') s.post({ open: true })
    })
    s.setState(true)
  }
  return s.elements.Text({ dimColor: true, children: `${props.text}  ›` })
}
export default Opener
