import { safeText } from './render.js';
import type { ToolStat, View } from './types.js';

export interface InteractiveState {
  readonly view: View;
  readonly query: string;
  readonly searching: boolean;
  readonly selected: number;
  readonly offset: number;
  readonly quitting: boolean;
}

export interface InteractiveKey {
  readonly name: string;
  readonly sequence: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

export const initialState: InteractiveState = {
  view: 'tools',
  query: '',
  searching: false,
  selected: 0,
  offset: 0,
  quitting: false,
};

const nextView: Readonly<Record<View, View>> = {
  tools: 'calendar',
  calendar: 'weekdays',
  weekdays: 'tools',
};

export function matchingTools(tools: readonly ToolStat[], query: string): readonly ToolStat[] {
  const normalized = query.toLocaleLowerCase('en-US');
  return tools.filter((tool) =>
    safeText(tool.name).toLocaleLowerCase('en-US').includes(normalized),
  );
}

/** Keep the selection visible after filtering, movement, or resizing. */
export function fitViewport(
  state: InteractiveState,
  count: number,
  rows: number,
): InteractiveState {
  const selected = Math.max(0, Math.min(state.selected, count - 1));
  const previous = Math.max(0, Math.min(state.offset, selected));
  const offset = selected >= previous + rows ? selected - rows + 1 : previous;
  return { ...state, selected, offset };
}

function editQuery(state: InteractiveState, key: InteractiveKey): InteractiveState {
  if (key.name === 'return') return { ...state, searching: false };
  if (key.name === 'backspace') {
    return { ...state, query: Array.from(state.query).slice(0, -1).join(''), selected: 0 };
  }
  const printable =
    !key.ctrl &&
    !key.meta &&
    safeText(key.sequence) === key.sequence &&
    Array.from(key.sequence).length === 1;
  if (!printable) return state;
  return {
    ...state,
    query: Array.from(state.query + key.sequence)
      .slice(0, 128)
      .join(''),
    selected: 0,
  };
}

/** Search mode treats navigation letters and q as text, never as commands. */
export function reduceKey(
  state: InteractiveState,
  key: InteractiveKey,
  count: number,
): InteractiveState {
  if (key.name === 'tab') return { ...state, view: nextView[state.view], searching: false };
  if (key.name === 'escape') return { ...initialState, view: state.view };
  if (state.searching) return editQuery(state, key);
  if (key.name === 'q') return { ...state, quitting: true };
  if (state.view !== 'tools') return state;
  if (key.sequence === '/') return { ...state, searching: true };
  switch (key.name) {
    case 'j':
    case 'down':
      return { ...state, selected: state.selected + 1 };
    case 'k':
    case 'up':
      return { ...state, selected: state.selected - 1 };
    case 'g':
      return { ...state, selected: key.shift ? count - 1 : 0 };
    case 'home':
      return { ...state, selected: 0 };
    case 'end':
      return { ...state, selected: count - 1 };
    default:
      return state;
  }
}
