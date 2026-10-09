/**
 * The line above the prompt (SPEC.md §11.3): a report waiting to be read, or
 * the habit of the week and this week's progress, or a moment's nudge. It
 * draws one line, narrows by dropping detail, and stacks with other mods' bars.
 */
import type { Color, ElementTable, RenderElement, RenderSurface } from 'claude-code'

import { BAR, HABIT } from './copy'
import type { BarState } from './select'

type Span = { text: string; color?: Color; bold?: boolean; dim?: boolean }
type Layout = { left: Span[]; right: Span[]; dots: boolean }

const span = (text: string, style: Omit<Span, 'text'> = {}): Span => ({ text, ...style })
const widthOf = (spans: Span[]) => spans.reduce((n, s) => n + [...s.text].length, 0)

const DOT_DONE = '#4eba65'
const DOT_LEFT = '#8a8a8a'

/** Every way the line can be drawn, richest first. */
export function layouts(state: BarState): Layout[] {
  const mark = span('● ', { color: 'claude' })
  switch (state.kind) {
    case 'hidden':
      return []
    case 'nudge':
      return [
        { left: [span('● ', { color: 'warning' }), span(`Coach: ${state.text}`)], right: [], dots: false },
        { left: [span('● ', { color: 'warning' }), span(state.text)], right: [], dots: false },
      ]
    case 'ready': {
      const text = state.first ? BAR.first(state.days) : BAR.ready
      return [
        { left: [mark, span(text)], right: [span('/coach', { dim: true })], dots: false },
        { left: [mark, span(text)], right: [], dots: false },
        { left: [mark, span('Coach: report ready')], right: [span('/coach', { dim: true })], dots: false },
      ]
    }
    case 'habit': {
      const words = HABIT[state.habit]
      const count =
        state.done !== null && state.total !== null
          ? [span(`${state.done} of ${state.total} ${words.unit}`, { dim: true })]
          : []
      const short = state.done !== null && state.total !== null ? [span(`${state.done} of ${state.total}`, { dim: true })] : []
      const lead = [span('Coach · this week: ', { dim: true }), span(words.bar, { bold: true })]
      return [
        { left: lead, right: count, dots: count.length > 0 },
        { left: lead, right: short, dots: false },
        { left: lead, right: [], dots: false },
        { left: [span(BAR.short(words.short))], right: [], dots: false },
      ]
    }
  }
}

function dotsWidth(state: BarState): number {
  return state.kind === 'habit' && state.total !== null ? Math.min(state.total, 8) + 1 : 0
}

export function fits(layout: Layout, state: BarState, columns: number): boolean {
  const dots = layout.dots ? dotsWidth(state) : 0
  return widthOf(layout.left) + 2 + dots + widthOf(layout.right) <= columns
}

/** "●●○" for 2 done of 3: one dot per item, at most eight. */
export function dotGlyphs(done: number, total: number): Span[] {
  const n = Math.min(total, 8)
  const filled = Math.round((Math.min(done, total) / Math.max(total, 1)) * n)
  return [span('●'.repeat(filled), { color: 'success' }), span('○'.repeat(n - filled), { dim: true })].filter(
    s => s.text,
  )
}

export function dotSvg(done: number, total: number): string {
  const n = Math.min(total, 8)
  const filled = Math.round((Math.min(done, total) / Math.max(total, 1)) * n)
  const r = 4
  const gap = 3
  const width = n * (2 * r + gap) - gap
  const circles = Array.from({ length: n }, (_, i) => {
    const cx = r + i * (2 * r + gap)
    return i < filled
      ? `<circle cx="${cx}" cy="${r}" r="${r}" fill="${DOT_DONE}"/>`
      : `<circle cx="${cx}" cy="${r}" r="${r - 0.75}" fill="none" stroke="${DOT_LEFT}" stroke-width="1.5"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${2 * r}" viewBox="0 0 ${width} ${2 * r}">${circles}</svg>`
}

/**
 * The coach line, or null when there's nothing to say. `onNudgeOff`, when the
 * line is a live hint, turns that kind of hint off.
 */
export function drawBar(
  els: ElementTable,
  surface: RenderSurface,
  bodyColumns: number,
  state: BarState,
  onNudgeOff: (() => void) | null,
): RenderElement | null {
  const columns = bodyColumns > 0 ? bodyColumns : 120
  const options = layouts(state)
  const chosen = options.find(l => fits(l, state, columns)) ?? options[options.length - 1]
  if (!chosen) return null
  const { Box, Text, Button } = els
  const texts = (spans: Span[]) =>
    spans.map(s => (
      <Text
        {...(s.color ? { color: s.color } : {})}
        {...(s.bold ? { bold: true } : {})}
        {...(s.dim ? { dimColor: true } : {})}
      >
        {s.text}
      </Text>
    ))
  let dots: RenderElement | null = null
  if (chosen.dots && state.kind === 'habit' && state.done !== null && state.total !== null) {
    if (surface !== 'terminal' && 'Svg' in els) {
      const { Svg } = els
      dots = (
        <Svg
          source={dotSvg(state.done, state.total)}
          alt={`${state.done} of ${state.total} done this week`}
          height={8}
        />
      )
    } else {
      dots = <Text>{texts(dotGlyphs(state.done, state.total))}</Text>
    }
  }
  const off =
    state.kind === 'nudge' && onNudgeOff ? (
      <Button key="nudge-off" label="Don't show this again" plain dimColor onPress={() => onNudgeOff()} />
    ) : null
  return (
    <Box width="100%" justifyContent="space-between">
      <Box flexShrink={1}>
        <Text wrap="truncate-end">{texts(chosen.left)}</Text>
      </Box>
      <Box flexShrink={0} alignItems="center" gap={1}>
        {dots}
        {chosen.right.length ? <Text>{texts(chosen.right)}</Text> : null}
        {off}
      </Box>
    </Box>
  )
}
