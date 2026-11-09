// S-7.10 / #227: ECharts, tree-shaken (echarts/core + only the charts and components we draw),
// in its own chunk. charts.ts loads it with import() so that the first screen (lock, loading)
// does not pay for it; it is fetched in the background as soon as the browser is idle.

import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { getInstanceByDom, init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

use([
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export { getInstanceByDom, init };
