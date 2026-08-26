import {
	ColorType,
	createChart,
	LineSeries,
	type AutoscaleInfo,
	type IChartApi,
	type ISeriesApi,
	type Time,
	type UTCTimestamp
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { ChartPoint } from './types';

const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23'
});

type MetricLineChartProps = {
	points: ChartPoint[];
	unit: '%' | 'MB';
};

export function MetricLineChart({ points, unit }: MetricLineChartProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi>(null);
	const seriesRef = useRef<ISeriesApi<'Line'>>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		const styles = getComputedStyle(document.documentElement);
		const color = (name: string) => styles.getPropertyValue(name).trim();
		const formatTime = (timestamp: number) => timeFormatter.format(new Date(timestamp * 1000));
		const chart = createChart(containerRef.current, {
			autoSize: true,
			// Chặn toàn bộ zoom
			handleScale: false,
			// Nếu muốn chặn luôn pan/scroll
			handleScroll: false,
			layout: {
				background: { type: ColorType.Solid, color: 'transparent' },
				textColor: color('--color-muted-strong'),
				fontSize: 10,
				attributionLogo: false
			},
			grid: {
				vertLines: { visible: false },
				horzLines: { color: color('--color-border-subtle') }
			},
			rightPriceScale: {
				borderVisible: false,
				minimumWidth: 54,
				scaleMargins: { top: 0.1, bottom: 0.05 }
			},
			timeScale: {
				borderColor: color('--color-border-subtle'),
				timeVisible: true,
				secondsVisible: true,
				tickMarkFormatter: (time: Time) => formatTime(time as number)
			},
			localization: {
				timeFormatter: (time: Time) => formatTime(time as number)
			}
		});
		const series = chart.addSeries(LineSeries, {
			color: color('--color-primary'),
			lineWidth: 2,
			lastValueVisible: false,
			priceLineVisible: false,
			priceFormat: {
				type: 'custom',
				minMove: 0.1,
				formatter: (value: number) => `${value.toFixed(1)} ${unit}`
			},
			autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
				const info = original();

				return info
					? {
							...info,
							priceRange: { ...info.priceRange, minValue: 0 }
						}
					: null;
			}
		});

		chartRef.current = chart;
		seriesRef.current = series;

		return () => {
			chartRef.current = null;
			seriesRef.current = null;
			chart.remove();
		};
	}, [unit]);

	useEffect(() => {
		if (!seriesRef.current) return;

		seriesRef.current.setData([
			...new Map(
				points.map(({ timestamp, value }) => [
					timestamp,
					{ time: timestamp as UTCTimestamp, value }
				])
			).values()
		]);
		chartRef.current?.timeScale().fitContent();
	}, [points]);

	return (
		<div
			aria-label={`Historical ${unit === '%' ? 'CPU' : 'RAM'} usage line chart`}
			className="h-full min-h-0 w-full"
			ref={containerRef}
			role="img"
		/>
	);
}
