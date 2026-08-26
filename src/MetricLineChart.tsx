import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis
} from 'recharts';
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
	return (
		<div
			aria-label={`Historical ${unit === '%' ? 'CPU' : 'RAM'} usage line chart`}
			className="h-full min-h-0 w-full"
			role="img"
		>
			<ResponsiveContainer height="100%" width="100%">
				<LineChart data={points} margin={{ top: 12, right: 14, bottom: 2, left: -16 }}>
					<CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
					<XAxis
						axisLine={{ stroke: 'var(--color-border-subtle)' }}
						dataKey="timestamp"
						minTickGap={30}
						tick={{ fill: 'var(--color-muted-strong)', fontSize: 10 }}
						tickFormatter={(value: number) => timeFormatter.format(new Date(value * 1000))}
						tickLine={false}
					/>
					<YAxis
						axisLine={false}
						domain={[0, 'auto']}
						tick={{ fill: 'var(--color-muted-strong)', fontSize: 10 }}
						tickLine={false}
						width={54}
					/>
					<Tooltip
						contentStyle={{
							background: 'var(--color-surface-raised)',
							border: '1px solid var(--color-border)',
							borderRadius: 10,
							fontSize: 11
						}}
						formatter={(value) => [
							`${Number(value).toFixed(1)} ${unit}`,
							unit === '%' ? 'CPU' : 'RAM'
						]}
						labelFormatter={(value) => timeFormatter.format(new Date(Number(value) * 1000))}
					/>
					<Line
						activeDot={{ r: 3 }}
						animationDuration={250}
						dataKey="value"
						dot={false}
						isAnimationActive={false}
						stroke="var(--color-primary)"
						strokeWidth={2}
						type="monotone"
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
