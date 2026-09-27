import { renderCalendar, renderWeekdays } from './calendar.js';
import { createToolFilter } from './interactive-state.js';
import { activityLines, fitText } from './render.js';
import type { Report, ToolStat, View } from './types.js';

export interface InteractiveData {
  readonly tools: (query: string) => readonly ToolStat[];
  readonly lines: (view: View, width: number) => readonly string[];
}

function viewLines(report: Report, view: View, width: number, ascii: boolean): readonly string[] {
  if (view === 'tools') {
    return activityLines(report, width, ascii).map((line, index) =>
      index === 0 ? `All tools: ${line}` : line,
    );
  }
  const content =
    view === 'calendar'
      ? renderCalendar(report, width, ascii)
      : renderWeekdays(report, width, ascii);
  return content.trimEnd().split('\n');
}

/** Report data is immutable. Retain three derived views at only the current width. */
export function createInteractiveData(report: Report, ascii: boolean): InteractiveData {
  let previousWidth = 0;
  const cache = new Map<View, readonly string[]>();
  return {
    tools: createToolFilter(report.tools),
    lines(view: View, width: number): readonly string[] {
      if (width !== previousWidth) {
        cache.clear();
        previousWidth = width;
      }
      const previous = cache.get(view);
      if (previous) return previous;
      const result = viewLines(report, view, width, ascii).map((line) =>
        fitText(line, width, ascii),
      );
      cache.set(view, result);
      return result;
    },
  };
}
