export type Monitor = {
	id: number;
	port: number;
	name: string | null;
	pid: number | null;
	processName: string | null;
	status: 'online' | 'offline' | string;
	cpuPercent: number | null;
	memoryBytes: number | null;
	observedAt: number | null;
};

export type Sample = {
	observedAt: number;
	pid: number | null;
	cpuPercent: number | null;
	memoryBytes: number | null;
};

export type AppMetrics = {
	cpuPercent: number | null;
	memoryBytes: number | null;
};

export type MonitorSnapshot = {
	monitors: Monitor[];
	appMetrics: AppMetrics;
};

export type ChartPoint = { timestamp: number; value: number };
