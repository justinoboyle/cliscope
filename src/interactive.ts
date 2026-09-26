import type { BorderCharacters, KeyEvent } from '@opentui/core';
import {
  activityLines,
  fitText,
  formatCount,
  renderToolRow,
  safeText,
  terminalWidth,
  type RenderOptions,
} from './render.js';
import type { Report } from './types.js';

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

/** OpenTUI is loaded only for interactive mode, keeping ordinary reports lightweight. */
export async function runInteractive(report: Report, options: RenderOptions): Promise<void> {
  const { BoxRenderable, TextRenderable, createCliRenderer } = await import('@opentui/core');
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    exitSignals: ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'],
    useMouse: false,
    backgroundColor: options.color ? '#101722' : 'transparent',
  });
  let removeListeners: (() => void) | undefined;
  try {
    const foreground = options.color ? '#dce6f4' : undefined;
    const muted = options.color ? '#91a1b8' : undefined;
    const accent = options.color ? '#65d9c2' : undefined;
    const screen = new BoxRenderable(renderer, {
      width: '100%',
      height: '100%',
      padding: 1,
      flexDirection: 'column',
      ...(options.color ? { backgroundColor: '#101722' } : {}),
    });
    const heading = new TextRenderable(renderer, {
      height: 3,
      ...(accent ? { fg: accent } : {}),
    });
    const search = new TextRenderable(renderer, {
      height: 2,
      ...(muted ? { fg: muted } : {}),
    });
    const chart = new BoxRenderable(renderer, {
      flexGrow: 1,
      border: true,
      borderStyle: options.ascii ? 'single' : 'rounded',
      ...(options.ascii ? { customBorderChars: asciiBorder } : {}),
      title: ' Tool ranking ',
      ...(muted ? { borderColor: muted } : {}),
      paddingX: 1,
    });
    const ranking = new TextRenderable(renderer, {
      width: '100%',
      height: '100%',
      ...(foreground ? { fg: foreground } : {}),
    });
    const detailPanel = new BoxRenderable(renderer, {
      height: 6,
      border: true,
      borderStyle: options.ascii ? 'single' : 'rounded',
      ...(options.ascii ? { customBorderChars: asciiBorder } : {}),
      title: ' Selected tool ',
      ...(accent ? { borderColor: accent } : {}),
      paddingX: 1,
    });
    const detail = new TextRenderable(renderer, {
      width: '100%',
      ...(foreground ? { fg: foreground } : {}),
    });
    const help = new TextRenderable(renderer, {
      height: 1,
      ...(muted ? { fg: muted } : {}),
    });
    chart.add(ranking);
    detailPanel.add(detail);
    screen.add(heading);
    screen.add(search);
    screen.add(chart);
    screen.add(detailPanel);
    screen.add(help);
    renderer.root.add(screen);

    let query = '';
    let searching = false;
    let selected = 0;
    let offset = 0;
    const matchingTools = (): typeof report.tools =>
      report.tools.filter((tool) =>
        safeText(tool.name).toLocaleLowerCase('en-US').includes(query.toLocaleLowerCase('en-US')),
      );
    const redraw = (): void => {
      const width = terminalWidth(renderer.width - 2);
      const chartWidth = Math.max(1, width - 4);
      const compact = renderer.height < 20;
      detailPanel.visible = !compact;
      heading.height = compact ? 1 : 3;
      search.height = compact ? 1 : 2;
      const rows = Math.max(1, renderer.height - (compact ? 7 : 16));
      const tools = matchingTools();
      selected = Math.max(0, Math.min(selected, tools.length - 1));
      offset = Math.max(0, Math.min(offset, selected));
      if (selected >= offset + rows) offset = selected - rows + 1;
      const truncate = (value: string): string => fitText(value, width, options.ascii);
      heading.content = compact
        ? truncate('CLISCOPE')
        : [
            truncate('CLISCOPE  /  YOUR TERMINAL, IN NUMBERS'),
            truncate(
              `${formatCount(report.totalInvocations)} invocations  |  ${formatCount(report.uniqueTools)} tools  |  ${formatCount(report.totalEntries)} history entries`,
            ),
            truncate(`Source: ${options.source}`),
          ].join('\n');
      search.content = truncate(
        `${searching ? '/ ' : 'Filter: '}${query || (searching ? '_' : 'all tools')}  |  ${tools.length} matches`,
      );
      ranking.content =
        tools.length === 0
          ? fitText(
              query ? 'No tools match this filter.' : 'No CLI tools found in this history.',
              chartWidth,
              options.ascii,
            )
          : tools
              .slice(offset, offset + rows)
              .map((tool, index) => {
                const position = offset + index;
                return `${position === selected ? '>' : ' '} ${renderToolRow(tool, position + 1, report.tools[0]?.count ?? 0, Math.max(1, chartWidth - 2), options.ascii)}`;
              })
              .join('\n');
      const tool = tools[selected];
      const activity = activityLines(report, Math.max(1, chartWidth), options.ascii);
      detail.content = [
        tool
          ? `${safeText(tool.name)}  |  ${formatCount(tool.count)} invocations  |  ${(tool.share * 100).toFixed(1)}% of all invocations`
          : 'Select a tool to see its share.',
        ...activity.map((line, index) => (index === 0 ? `All tools: ${line}` : line)),
      ]
        .map((line) => fitText(line, chartWidth, options.ascii))
        .join('\n');
      help.content = truncate(
        searching
          ? 'Type to filter  |  Enter done  |  Esc reset  |  Ctrl+C quit'
          : 'j/k or arrows move  |  / filter  |  Esc reset  |  q quit',
      );
    };

    await new Promise<void>((resolve, reject) => {
      const update = (): void => {
        try {
          redraw();
        } catch (error: unknown) {
          reject(error);
        }
      };
      const onKey = (key: KeyEvent): void => {
        if (key.name === 'escape') {
          query = '';
          searching = false;
          selected = 0;
          offset = 0;
        } else if (searching) {
          if (key.name === 'return') searching = false;
          else if (key.name === 'backspace') {
            query = Array.from(query).slice(0, -1).join('');
            selected = 0;
          } else if (
            !key.ctrl &&
            !key.meta &&
            safeText(key.sequence) === key.sequence &&
            key.sequence.length > 0 &&
            Array.from(key.sequence).length === 1
          ) {
            query = (query + key.sequence).slice(0, 128);
            selected = 0;
          }
        } else if (key.name === 'q') {
          renderer.destroy();
          return;
        } else if (key.sequence === '/') searching = true;
        else if (key.name === 'j' || key.name === 'down') selected++;
        else if (key.name === 'k' || key.name === 'up') selected--;
        else if (key.name === 'end' || (key.name === 'g' && key.shift))
          selected = matchingTools().length - 1;
        else if (key.name === 'home' || key.name === 'g') selected = 0;
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
    renderer.destroy();
  }
}
