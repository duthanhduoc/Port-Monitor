<script lang="ts">
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
	import { onMount } from 'svelte';

	export type ChartPoint = {
		timestamp: number;
		value: number;
	};

	type Props = {
		points: ChartPoint[];
		unit: '%' | 'MB';
	};

	let { points, unit }: Props = $props();

	let container: HTMLDivElement;
	let chart: IChartApi | null = null;
	let series: ISeriesApi<'Line'> | null = null;

	const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	});

	function formatTime(timestamp: number) {
		return timeFormatter.format(new Date(timestamp * 1000));
	}

	function getChartData() {
		return [
			...new Map(
				points.map(({ timestamp, value }) => [
					timestamp,
					{
						time: timestamp as UTCTimestamp,
						value
					}
				])
			).values()
		].sort((a, b) => Number(a.time) - Number(b.time));
	}

	function updateData() {
		if (!series) return;

		series.setData(getChartData());
		chart?.timeScale().fitContent();
	}

	onMount(() => {
		const styles = getComputedStyle(document.documentElement);

		const color = (name: string) => styles.getPropertyValue(name).trim();

		chart = createChart(container, {
			autoSize: true,

			// Không cho user zoom chart
			handleScale: false,

			// Không cho drag / scroll chart
			handleScroll: false,

			layout: {
				background: {
					type: ColorType.Solid,
					color: 'transparent'
				},
				textColor: color('--color-muted-strong'),
				fontSize: 10,

				// Ẩn icon TradingView
				attributionLogo: false
			},

			grid: {
				vertLines: {
					visible: false
				},
				horzLines: {
					color: color('--color-border-subtle')
				}
			},

			rightPriceScale: {
				borderVisible: false,
				minimumWidth: 54,
				scaleMargins: {
					top: 0.1,
					bottom: 0.05
				}
			},

			timeScale: {
				borderColor: color('--color-border-subtle'),
				timeVisible: true,
				secondsVisible: true,

				tickMarkFormatter: (time: Time) => {
					return formatTime(time as number);
				}
			},

			localization: {
				timeFormatter: (time: Time) => {
					return formatTime(time as number);
				}
			}
		});

		series = chart.addSeries(LineSeries, {
			color: color('--color-primary'),
			lineWidth: 2,

			lastValueVisible: false,
			priceLineVisible: false,

			priceFormat: {
				type: 'custom',
				minMove: 0.1,
				formatter: (value: number) => `${value.toFixed(1)} ${unit}`
			},

			// Y luôn bắt đầu từ 0
			autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
				const info = original();

				if (!info) return null;

				return {
					...info,
					priceRange: {
						...info.priceRange,
						minValue: 0
					}
				};
			}
		});

		updateData();

		return () => {
			series = null;

			chart?.remove();
			chart = null;
		};
	});

	$effect(() => {
		// Track points
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		points;

		updateData();
	});
</script>

<div
	bind:this={container}
	class="h-full min-h-0 w-full"
	role="img"
	aria-label={`Historical ${unit === '%' ? 'CPU' : 'RAM'} usage line chart`}
></div>