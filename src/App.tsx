import {
	Alert,
	Button,
	Card,
	Input,
	Spinner,
	Table,
	TextField,
	type Selection
} from '@heroui/react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MetricLineChart } from './MetricLineChart';
import type { AppMetrics, Monitor, MonitorSnapshot, Sample } from './types';

const EMPTY_METRICS: AppMetrics = { cpuPercent: null, memoryBytes: null };
const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23'
});

function formatMemory(bytes: number | null) {
	if (bytes === null) return '—';
	return bytes < 1_000_000
		? `${Math.round(bytes / 1_000)} KB`
		: `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatCpu(cpu: number | null) {
	return cpu === null ? '—' : `${cpu.toFixed(1)}%`;
}

function formatTime(timestamp: number | null) {
	return timestamp ? timeFormatter.format(new Date(timestamp * 1000)) : 'No data yet';
}

function Status({ status }: { status: string }) {
	const online = status === 'online';
	return (
		<span className={online ? 'status status-online' : 'status status-offline'}>
			<i aria-hidden="true" />
			{online ? 'ONLINE' : status.toUpperCase()}
		</span>
	);
}

export default function App() {
	const [monitors, setMonitors] = useState<Monitor[]>([]);
	const [history, setHistory] = useState<Sample[]>([]);
	const [portInput, setPortInput] = useState<number | undefined>();
	const [nameInput, setNameInput] = useState('');
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const [editingNameId, setEditingNameId] = useState<number | null>(null);
	const [nameDraft, setNameDraft] = useState('');
	const [actingId, setActingId] = useState<number | null>(null);
	const [confirmingAction, setConfirmingAction] = useState<string | null>(null);
	const [message, setMessage] = useState('');
	const [error, setError] = useState('');
	const [appMetrics, setAppMetrics] = useState<AppMetrics>(EMPTY_METRICS);
	const selectedIdRef = useRef<number | null>(null);
	const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const selected = monitors.find((monitor) => monitor.id === selectedId) ?? monitors[0] ?? null;
	const onlineCount = monitors.filter((monitor) => monitor.status === 'online').length;
	const cpuChartData = useMemo(
		() =>
			history.flatMap((sample) =>
				sample.cpuPercent === null
					? []
					: [{ timestamp: sample.observedAt, value: sample.cpuPercent }]
			),
		[history]
	);
	const ramChartData = useMemo(
		() =>
			history.flatMap((sample) =>
				sample.memoryBytes === null
					? []
					: [{ timestamp: sample.observedAt, value: sample.memoryBytes / 1024 / 1024 }]
			),
		[history]
	);

	const selectMonitor = useCallback((id: number | null) => {
		selectedIdRef.current = id;
		setSelectedId(id);
	}, []);

	const loadHistory = useCallback(async (id: number) => {
		try {
			setHistory(await invoke<Sample[]>('get_metric_history', { id }));
		} catch (cause) {
			setError(String(cause));
		}
	}, []);

	const loadMonitors = useCallback(async () => {
		try {
			const rows = await invoke<Monitor[]>('list_monitored_ports');
			setMonitors(rows);
			const current = selectedIdRef.current;
			const nextId = rows.some((monitor) => monitor.id === current)
				? current
				: (rows[0]?.id ?? null);
			selectMonitor(nextId);
			if (nextId === null) setHistory([]);
			else await loadHistory(nextId);
		} catch (cause) {
			setError(String(cause));
		}
	}, [loadHistory, selectMonitor]);

	useEffect(() => {
		let active = true;
		let unlisten: UnlistenFn | undefined;

		if (!isTauri()) return;

		void (async () => {
			await loadMonitors();
			if (!active) return;
			const stop = await listen<MonitorSnapshot>('monitor:update', (event) => {
				if (!active) return;
				const rows = event.payload.monitors;
				setMonitors(rows);
				setAppMetrics(event.payload.appMetrics);
				const current = selectedIdRef.current;
				const nextId = rows.some((monitor) => monitor.id === current)
					? current
					: (rows[0]?.id ?? null);
				if (nextId !== current) selectMonitor(nextId);
				if (nextId === null) setHistory([]);
				else void loadHistory(nextId);
			});
			if (active) unlisten = stop;
			else stop();
		})();

		return () => {
			active = false;
			unlisten?.();
			if (messageTimer.current) clearTimeout(messageTimer.current);
		};
	}, [loadHistory, loadMonitors, selectMonitor]);

	function showMessage(text: string) {
		setMessage(text);
		if (messageTimer.current) clearTimeout(messageTimer.current);
		messageTimer.current = setTimeout(() => setMessage(''), 3500);
	}

	async function addPort(event: FormEvent) {
		event.preventDefault();
		if (
			!Number.isInteger(portInput) ||
			portInput === undefined ||
			portInput < 1 ||
			portInput > 65535
		) {
			setError('Port must be an integer between 1 and 65535.');
			return;
		}
		setSaving(true);
		setError('');
		try {
			const rows = await invoke<Monitor[]>('add_monitored_port', {
				port: portInput,
				name: nameInput.trim() || null
			});
			setMonitors(rows);
			const newId = rows.find((monitor) => monitor.port === portInput)?.id ?? selectedIdRef.current;
			selectMonitor(newId);
			setPortInput(undefined);
			setNameInput('');
			showMessage(`Now monitoring port ${portInput}`);
			if (newId !== null) await loadHistory(newId);
		} catch (cause) {
			setError(String(cause));
		} finally {
			setSaving(false);
		}
	}

	async function endProcess(monitor: Monitor) {
		if (!monitor.pid) return;
		const action = `end:${monitor.id}`;
		if (confirmingAction !== action) {
			setConfirmingAction(action);
			return;
		}
		setConfirmingAction(null);
		setError('');
		setActingId(monitor.id);
		try {
			await invoke('end_process', { id: monitor.id });
			showMessage(`End command sent to PID ${monitor.pid}`);
			await loadMonitors();
		} catch (cause) {
			setError(String(cause));
		} finally {
			setActingId(null);
		}
	}

	async function removeMonitor(monitor: Monitor) {
		const action = `remove:${monitor.id}`;
		if (confirmingAction !== action) {
			setConfirmingAction(action);
			return;
		}
		setConfirmingAction(null);
		setError('');
		setActingId(monitor.id);
		try {
			const rows = await invoke<Monitor[]>('remove_monitored_port', { id: monitor.id });
			setMonitors(rows);
			const nextId = rows[0]?.id ?? null;
			selectMonitor(nextId);
			if (nextId === null) setHistory([]);
			else await loadHistory(nextId);
		} catch (cause) {
			setError(String(cause));
		} finally {
			setActingId(null);
		}
	}

	function startRename(monitor: Monitor) {
		setEditingNameId(monitor.id);
		setNameDraft(monitor.name ?? monitor.processName ?? '');
	}

	async function saveName(monitor: Monitor) {
		if (!nameDraft.trim()) {
			setError('Process name cannot be empty.');
			return;
		}
		setError('');
		try {
			setMonitors(
				await invoke<Monitor[]>('rename_monitored_port', {
					id: monitor.id,
					name: nameDraft.trim()
				})
			);
			setEditingNameId(null);
			showMessage('Process name updated');
		} catch (cause) {
			setError(String(cause));
		}
	}

	function handleSelection(keys: Selection) {
		if (keys === 'all') return;
		const id = Number(keys.values().next().value);
		if (!Number.isFinite(id)) return;
		selectMonitor(id);
		void loadHistory(id);
	}

	return (
		<main className="min-h-screen px-4 py-7 sm:px-9 sm:py-12">
			<div className="mx-auto w-full max-w-5xl">
				<header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
					<div>
						<p className="eyebrow">LOCAL PROCESS OBSERVABILITY</p>
						<h1 className="mt-2 text-4xl font-semibold tracking-tight text-foreground">
							Port Monitor
						</h1>
					</div>
					<div className="flex flex-col gap-3 text-right">
						<div className="flex gap-5 text-xs text-muted">
							<span>
								APP CPU <strong>{formatCpu(appMetrics.cpuPercent)}</strong>
							</span>
							<span>
								APP RAM <strong>{formatMemory(appMetrics.memoryBytes)}</strong>
							</span>
						</div>
						<span className="status status-online self-end">
							<i aria-hidden="true" />
							LIVE · every 2 seconds
						</span>
					</div>
				</header>

				<section aria-label="Overview" className="my-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
					{[
						['MONITORED', monitors.length, 'port records'],
						['RUNNING', onlineCount, 'processes online'],
						['OFFLINE', monitors.length - onlineCount, 'records retained']
					].map(([label, value, description], index) => (
						<Card
							className="stat-card"
							key={label}
							variant={index === 1 ? 'tertiary' : 'secondary'}
						>
							<Card.Content className="flex items-center justify-between gap-4">
								<div>
									<span className="eyebrow">{label}</span>
									<small>{description}</small>
								</div>
								<strong>{value}</strong>
							</Card.Content>
						</Card>
					))}
				</section>

				<Card className="overflow-hidden p-0" variant="secondary">
					<Card.Header className="flex flex-col gap-5 p-5 lg:flex-row lg:items-end lg:justify-between">
						<div>
							<p className="eyebrow">MONITORED PORTS</p>
							<Card.Title className="mt-2 text-xl">Process list</Card.Title>
						</div>
						<form
							className="grid w-full gap-2 sm:grid-cols-[150px_1fr_auto] lg:w-auto"
							onSubmit={addPort}
						>
							<TextField
								aria-label="Port to monitor"
								name="port"
								value={portInput?.toString() ?? ''}
								variant="secondary"
								onChange={(value) => setPortInput(value === '' ? undefined : Number(value))}
							>
								<Input max={65535} min={1} placeholder="Port, e.g. 3000" type="number" />
							</TextField>
							<TextField
								aria-label="Optional name"
								value={nameInput}
								variant="secondary"
								onChange={setNameInput}
							>
								<Input maxLength={40} placeholder="Name (optional)" />
							</TextField>
							<Button isPending={saving} type="submit">
								<Plus size={16} />
								Add port
							</Button>
						</form>
					</Card.Header>

					{message && (
						<Alert className="mx-5 mb-3" status="success">
							<Alert.Indicator />
							<Alert.Content>
								<Alert.Title>{message}</Alert.Title>
							</Alert.Content>
						</Alert>
					)}
					{error && (
						<Alert className="mx-5 mb-3" status="danger">
							<Alert.Indicator />
							<Alert.Content>
								<Alert.Title>{error}</Alert.Title>
							</Alert.Content>
						</Alert>
					)}

					<Table variant="secondary">
						<Table.ScrollContainer>
							<Table.Content
								aria-label="Monitored ports"
								className="min-w-[760px]"
								selectedKeys={selectedId === null ? new Set() : new Set([selectedId])}
								selectionMode="single"
								onSelectionChange={handleSelection}
							>
								<Table.Header>
									<Table.Column isRowHeader>PORT</Table.Column>
									<Table.Column>NAME / PROCESS</Table.Column>
									<Table.Column>RAM</Table.Column>
									<Table.Column>CPU</Table.Column>
									<Table.Column>STATUS</Table.Column>
									<Table.Column className="text-end">ACTIONS</Table.Column>
								</Table.Header>
								<Table.Body>
									{monitors.map((monitor) => (
										<Table.Row
											id={monitor.id}
											key={monitor.id}
											textValue={`${monitor.port} ${monitor.name ?? monitor.processName ?? ''}`}
										>
											<Table.Cell>
												<Button size="sm" variant="ghost" onPress={() => selectMonitor(monitor.id)}>
													{monitor.port}
												</Button>
											</Table.Cell>
											<Table.Cell>
												{editingNameId === monitor.id ? (
													<div className="flex items-center gap-1.5">
														<TextField
															aria-label="New process name"
															value={nameDraft}
															variant="secondary"
															onChange={setNameDraft}
														>
															<Input maxLength={40} />
														</TextField>
														<Button
															isIconOnly
															aria-label="Save process name"
															size="sm"
															onPress={() => void saveName(monitor)}
														>
															<Check size={15} />
														</Button>
														<Button
															isIconOnly
															aria-label="Cancel rename"
															size="sm"
															variant="tertiary"
															onPress={() => setEditingNameId(null)}
														>
															<X size={15} />
														</Button>
													</div>
												) : (
													<div className="flex items-center gap-2">
														<strong className="max-w-44 truncate">
															{monitor.name ?? monitor.processName ?? '—'}
														</strong>
														<Button
															isIconOnly
															aria-label="Rename process"
															size="sm"
															variant="ghost"
															onPress={() => startRename(monitor)}
														>
															<Pencil size={14} />
														</Button>
													</div>
												)}
												<small>
													{monitor.name && monitor.processName ? `${monitor.processName} · ` : ''}
													{monitor.pid ? `PID ${monitor.pid}` : 'No process found'}
												</small>
											</Table.Cell>
											<Table.Cell>{formatMemory(monitor.memoryBytes)}</Table.Cell>
											<Table.Cell>{formatCpu(monitor.cpuPercent)}</Table.Cell>
											<Table.Cell>
												<Status status={monitor.status} />
											</Table.Cell>
											<Table.Cell>
												<div className="flex justify-end gap-2">
													{monitor.pid && confirmingAction !== `remove:${monitor.id}` && (
														<>
															<Button
																isDisabled={actingId === monitor.id}
																size="sm"
																variant="danger"
																onPress={() => void endProcess(monitor)}
															>
																{actingId === monitor.id ? (
																	<Spinner size="sm" />
																) : confirmingAction === `end:${monitor.id}` ? (
																	'Confirm end'
																) : (
																	'End'
																)}
															</Button>
															{confirmingAction === `end:${monitor.id}` && (
																<Button
																	size="sm"
																	variant="tertiary"
																	onPress={() => setConfirmingAction(null)}
																>
																	Cancel
																</Button>
															)}
														</>
													)}
													{confirmingAction !== `end:${monitor.id}` && (
														<>
															<Button
																isDisabled={actingId === monitor.id}
																size="sm"
																variant={
																	confirmingAction === `remove:${monitor.id}`
																		? 'danger'
																		: 'tertiary'
																}
																onPress={() => void removeMonitor(monitor)}
															>
																{actingId === monitor.id ? (
																	<Spinner size="sm" />
																) : confirmingAction === `remove:${monitor.id}` ? (
																	'Confirm remove'
																) : (
																	'Remove'
																)}
															</Button>
															{confirmingAction === `remove:${monitor.id}` && (
																<Button
																	size="sm"
																	variant="ghost"
																	onPress={() => setConfirmingAction(null)}
																>
																	Cancel
																</Button>
															)}
														</>
													)}
												</div>
											</Table.Cell>
										</Table.Row>
									))}
								</Table.Body>
							</Table.Content>
						</Table.ScrollContainer>
					</Table>
					{monitors.length === 0 && (
						<p className="px-5 py-14 text-center text-sm text-muted">
							No monitored ports yet. Add a port above to get started.
						</p>
					)}
				</Card>

				<Card className="mt-5" variant="secondary">
					{selected ? (
						<>
							<Card.Header className="flex-row items-start justify-between">
								<div>
									<p className="eyebrow">PORT DETAIL</p>
									<Card.Title className="mt-2 text-3xl">{selected.port}</Card.Title>
									<Card.Description>
										{selected.name ?? selected.processName ?? 'Unnamed'}
									</Card.Description>
								</div>
								<Status status={selected.status} />
							</Card.Header>
							<Card.Content>
							<div className="detail-grid">
								<div>
									<span>PROCESS</span>
									<strong>{selected.processName ?? 'No listener found'}</strong>
								</div>
								<div>
									<span>PID</span>
									<strong>{selected.pid ?? '—'}</strong>
								</div>
								<div>
									<span>LAST SAMPLE</span>
										<strong>{formatTime(selected.observedAt)}</strong>
									</div>
								</div>
								<div className="space-y-5">
									<section>
										<div className="chart-title">
											<span>CPU USAGE</span>
											<strong>{formatCpu(selected.cpuPercent)}</strong>
										</div>
										<div className="chart">
											{/* <MetricLineChart points={cpuChartData} unit="%" /> */}
										</div>
										<small>X: time · Y: CPU (%)</small>
									</section>
									<section>
										<div className="chart-title">
											<span>RAM USAGE</span>
											<strong>{formatMemory(selected.memoryBytes)}</strong>
										</div>
										<div className="chart">
											{/* <MetricLineChart points={ramChartData} unit="MB" /> */}
										</div>
										<small>X: time · Y: RAM (MB)</small>
									</section>
								</div>
								<p className="mt-4 text-xs text-muted">
									{history.length} samples · retained by port even while the process is offline
								</p>
							</Card.Content>
						</>
					) : (
						<Card.Content className="py-20 text-center">
							<Card.Title>Select a port</Card.Title>
							<Card.Description>RAM and CPU charts will appear here.</Card.Description>
						</Card.Content>
					)}
				</Card>
			</div>
		</main>
	);
}
