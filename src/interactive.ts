import type * as OpenTuiModule from '@opentui/core';
import type {
  BorderCharacters,
  BoxRenderable,
  CliRenderer,
  KeyEvent,
  TextRenderable,
} from '@opentui/core';
import { createInteractiveData, type InteractiveData } from './interactive-data.js';
import {
  fitViewport,
  initialState,
  reduceKey,
  type InteractiveState,
} from './interactive-state.js';
import {
  fitText,
  formatCount,
  renderToolRow,
  safeText,
  terminalWidth,
  type RenderOptions,
} from './render.js';
import type { Report, ToolStat, View } from './types.js';

type OpenTui = typeof OpenTuiModule;

interface Dashboard {
  readonly heading: TextRenderable;
  readonly search: TextRenderable;
  readonly chart: BoxRenderable;
  readonly ranking: TextRenderable;
  readonly detailPanel: BoxRenderable;
  readonly detail: TextRenderable;
  readonly help: TextRenderable;
}

const asciiBorder: BorderCharacters = {
  topLeft: '+',
  topRight: '+',
  bottomLeft: '+',
  bottomRight: '+',
  horizontal: '-',
  vertical: '|',
  topT: '+',
  bottomT: '+',
  leftT: '+',
  rightT: '+',
  cross: '+',
};

function createDashboard(
  library: OpenTui,
  renderer: CliRenderer,
  options: RenderOptions,
): Dashboard {
  const { BoxRenderable, TextRenderable, RGBA } = library;
  const colors = options.color
    ? { foreground: '#dce6f4', muted: '#91a1b8', accent: '#65d9c2', background: '#101722' }
    : {
        foreground: RGBA.defaultForeground(),
        muted: RGBA.defaultForeground(),
        accent: RGBA.defaultForeground(),
        background: RGBA.defaultBackground(),
      };
  const border = options.ascii ? { customBorderChars: asciiBorder } : {};
  const screen = new BoxRenderable(renderer, {
    width: '100%',
    height: '100%',
    padding: 1,
    flexDirection: 'column',
    backgroundColor: colors.background,
  });
  const heading = new TextRenderable(renderer, { height: 2, fg: colors.accent });
  const search = new TextRenderable(renderer, { height: 2, fg: colors.muted });
  const chart = new BoxRenderable(renderer, {
    flexGrow: 1,
    border: true,
    borderStyle: 'rounded',
    ...border,
    title: ' Tool ranking ',
    borderColor: colors.muted,
    paddingX: 1,
  });
  const ranking = new TextRenderable(renderer, {
    width: '100%',
    height: '100%',
    fg: colors.foreground,
  });
  const detailPanel = new BoxRenderable(renderer, {
    height: 6,
    border: true,
    borderStyle: 'rounded',
    ...border,
    title: ' Selected tool ',
    borderColor: colors.accent,
    paddingX: 1,
  });
  const detail = new TextRenderable(renderer, { width: '100%', fg: colors.foreground });
  const help = new TextRenderable(renderer, { height: 1, fg: colors.muted });
  chart.add(ranking);
  detailPanel.add(detail);
  for (const child of [heading, search, chart, detailPanel, help]) screen.add(child);
  renderer.root.add(screen);
  return { heading, search, chart, ranking, detailPanel, detail, help };
}

function rankingText(
  tools: readonly ToolStat[],
  state: InteractiveState,
  rows: number,
  maximum: number,
  width: number,
  ascii: boolean,
): string {
  if (tools.length === 0) {
    const message = state.query ? 'No tools match this filter.' : 'No tools found in this history.';
    return fitText(message, width, ascii);
  }
  return tools
    .slice(state.offset, state.offset + rows)
    .map((tool, index) => {
      const position = state.offset + index;
      const marker = position === state.selected ? '>' : ' ';
      return `${marker} ${renderToolRow(tool, position + 1, maximum, Math.max(1, width - 2), ascii)}`;
    })
    .join('\n');
}

function detailText(
  data: InteractiveData,
  tool: ToolStat | undefined,
  width: number,
  ascii: boolean,
): string {
  const summary = tool
    ? `${safeText(tool.name)}  |  ${formatCount(tool.count)} invocations  |  ${(tool.share * 100).toFixed(1)}% of all invocations`
    : 'Select a tool to see its share.';
  return [fitText(summary, width, ascii), ...data.lines('tools', width)].join('\n');
}

function filterText(state: InteractiveState, count: number): string {
  const prefix = state.searching ? '/ ' : 'Filter: ';
  const placeholder = state.searching ? '_' : 'all tools';
  return `${prefix}${state.query || placeholder}  |  ${count} ${count === 1 ? 'match' : 'matches'}`;
}

const viewTitles: Readonly<Record<View, string>> = {
  tools: ' Tool ranking ',
  calendar: ' Calendar / UTC ',
  weekdays: ' Weekdays / UTC ',
};

function chartText(
  report: Report,
  data: InteractiveData,
  tools: readonly ToolStat[],
  state: InteractiveState,
  rows: number,
  width: number,
  ascii: boolean,
): string {
  if (state.view === 'tools') {
    return rankingText(tools, state, rows, report.tools[0]?.count ?? 0, width, ascii);
  }
  return data.lines(state.view, width).slice(0, rows).join('\n');
}

function helpText(state: InteractiveState): string {
  if (state.view !== 'tools') return 'Tab switch view  |  q quit';
  if (state.searching) return 'Type to filter  |  Enter done  |  Esc reset  |  Ctrl+C quit';
  return 'j/k move  |  / filter  |  Tab view  |  Esc reset  |  q quit';
}

function drawDashboard(
  view: Dashboard,
  renderer: CliRenderer,
  report: Report,
  options: RenderOptions,
  data: InteractiveData,
  current: InteractiveState,
): InteractiveState {
  const width = terminalWidth(renderer.width - 2);
  const chartWidth = Math.max(1, width - 4);
  const compact = renderer.height < 20;
  const showDetail = !compact && current.view === 'tools';
  const reserved = (compact ? 7 : 9) + (showDetail ? 6 : 0);
  const rows = Math.max(1, renderer.height - reserved);
  const tools = data.tools(current.query);
  const state = fitViewport(current, tools.length, rows);
  const truncate = (value: string): string => fitText(value, width, options.ascii);
  const summary = `${formatCount(report.totalInvocations)} invocations  |  ${formatCount(report.uniqueTools)} tools  |  ${formatCount(report.totalEntries)} history entries`;
  view.detailPanel.visible = showDetail;
  view.heading.height = compact ? 1 : 2;
  view.search.height = compact ? 1 : 2;
  view.heading.content = compact
    ? truncate(summary)
    : [summary, `Source: ${options.source}`].map(truncate).join('\n');
  view.search.content = truncate(
    state.view === 'tools' ? filterText(state, tools.length) : 'All timestamped invocations',
  );
  view.chart.title = viewTitles[state.view];
  view.ranking.content = chartText(report, data, tools, state, rows, chartWidth, options.ascii);
  if (showDetail) {
    view.detail.content = detailText(data, tools[state.selected], chartWidth, options.ascii);
  }
  view.help.content = truncate(helpText(state));
  return state;
}

async function handleInput(
  renderer: CliRenderer,
  view: Dashboard,
  report: Report,
  options: RenderOptions,
): Promise<void> {
  const data = createInteractiveData(report, options.ascii);
  let state = { ...initialState, view: options.view ?? 'tools' };
  let removeListeners: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const update = (): void => {
        try {
          state = drawDashboard(view, renderer, report, options, data, state);
        } catch (error: unknown) {
          reject(error);
        }
      };
      const onKey = (key: KeyEvent): void => {
        const count = data.tools(state.query).length;
        state = reduceKey(state, key, count);
        if (state.quitting) {
          renderer.destroy();
          return;
        }
        update();
      };
      renderer.once('destroy', resolve);
      renderer.keyInput.on('keypress', onKey);
      renderer.on('resize', update);
      removeListeners = (): void => {
        renderer.off('destroy', resolve);
        renderer.keyInput.off('keypress', onKey);
        renderer.off('resize', update);
      };
      update();
    });
  } finally {
    removeListeners?.();
  }
}

/** OpenTUI is loaded only for interactive mode, keeping ordinary reports lightweight. */
export async function runInteractive(report: Report, options: RenderOptions): Promise<void> {
  const library = await import('@opentui/core');
  const renderer = await library.createCliRenderer({
    exitOnCtrlC: true,
    exitSignals: ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'],
    useMouse: false,
    backgroundColor: options.color ? '#101722' : 'transparent',
  });
  try {
    const view = createDashboard(library, renderer, options);
    await handleInput(renderer, view, report, options);
  } finally {
    renderer.destroy();
  }
}
