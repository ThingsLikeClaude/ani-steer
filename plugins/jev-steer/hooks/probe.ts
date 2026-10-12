import type { ClientModule } from 'claude-code'

// Reports the width the pane really has, so the hooks module can lay its
// type-set rows out to it. Remembers what it last sent outside the instance
// state (setState on each redraw reads as a loop and unmounts it), and only
// speaks up for a real change: a scrollbar coming and going is a column or two.
let last = 0

const Probe: ClientModule<unknown> = (_props, s) => {
  if (s.columns > 0 && Math.abs(s.columns - last) >= 3) {
    last = s.columns
    s.post({ cols: s.columns })
  }
  return s.elements.Box({ height: 0 })
}
export default Probe
