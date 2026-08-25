<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { Pencil, Plus, X } from '@lucide/svelte';
	import { LineChart, defaultChartPadding } from 'layerchart';
	import { onMount } from 'svelte';
	import './base.css';

	type Monitor = {
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
	type Sample = {
		observedAt: number;
		pid: number | null;
		cpuPercent: number | null;
		memoryBytes: number | null;
	};
	type AppMetrics = { cpuPercent: number | null; memoryBytes: number | null };
	type MonitorSnapshot = { monitors: Monitor[]; appMetrics: AppMetrics };
	const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	});
	const chartProps = {
		xAxis: {
			tickLabelProps: { fill: 'var(--color-muted-strong)', fontSize: 12, stroke: 'none' }
		},
		yAxis: {
			tickLabelProps: { fill: 'var(--color-muted-strong)', fontSize: 12, stroke: 'none' }
		},
		tooltip: {
			root: { variant: 'default' },
			header: { format: formatChartTime }
		}
	} as const;

	let monitors = $state<Monitor[]>([]);
	let history = $state<Sample[]>([]);
	let portInput = $state('');
	let nameInput = $state('');
	let selectedId = $state<number | null>(null);
	let saving = $state(false);
	let editingNameId = $state<number | null>(null);
	let nameDraft = $state('');
	let actingId = $state<number | null>(null);
	let confirmingAction = $state<string | null>(null);
	let message = $state('');
	let error = $state('');
	let appMetrics = $state<AppMetrics>({ cpuPercent: null, memoryBytes: null });
	let messageTimer: ReturnType<typeof setTimeout> | undefined;

	const selected = $derived(
		monitors.find((monitor) => monitor.id === selectedId) ?? monitors[0] ?? null
	);
	const onlineCount = $derived(monitors.filter((monitor) => monitor.status === 'online').length);
	const cpuChartData = $derived(
		history
			.filter((sample) => sample.cpuPercent !== null)
			.map((sample) => ({
				date: new Date(sample.observedAt * 1000),
				value: sample.cpuPercent as number
			}))
	);
	const ramChartData = $derived(
		history
			.filter((sample) => sample.memoryBytes !== null)
			.map((sample) => ({
				date: new Date(sample.observedAt * 1000),
				value: (sample.memoryBytes as number) / 1024 / 1024
			}))
	);

	async function loadMonitors() {
		try {
			monitors = await invoke<Monitor[]>('list_monitored_ports');
			if (selectedId === null && monitors[0]) selectedId = monitors[0].id;
			if (selectedId !== null) await loadHistory(selectedId);
		} catch (cause) {
			error = String(cause);
		}
	}

	async function loadHistory(id: number) {
		try {
			history = await invoke<Sample[]>('get_metric_history', { id });
		} catch (cause) {
			error = String(cause);
		}
	}

	async function addPort(event: SubmitEvent) {
		event.preventDefault();
		const port = Number(portInput);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			error = 'Port must be an integer between 1 and 65535.';
			return;
		}
		saving = true;
		error = '';
		try {
			monitors = await invoke<Monitor[]>('add_monitored_port', {
				port,
				name: nameInput.trim() || null
			});
			selectedId = monitors.find((monitor) => monitor.port === port)?.id ?? selectedId;
			portInput = '';
			nameInput = '';
			showMessage(`Now monitoring port ${port}`);
			if (selectedId !== null) await loadHistory(selectedId);
		} catch (cause) {
			error = String(cause);
		} finally {
			saving = false;
		}
	}

	function showMessage(text: string) {
		message = text;
		if (messageTimer) clearTimeout(messageTimer);
		messageTimer = setTimeout(() => {
			message = '';
		}, 3500);
	}

	async function endProcess(monitor: Monitor) {
		if (!monitor.pid) return;
		const action = `end:${monitor.id}`;
		if (confirmingAction !== action) {
			confirmingAction = action;
			return;
		}
		confirmingAction = null;
		error = '';
		actingId = monitor.id;
		try {
			await invoke('end_process', { id: monitor.id });
			showMessage(`End command sent to PID ${monitor.pid}`);
			await loadMonitors();
		} catch (cause) {
			error = String(cause);
		} finally {
			actingId = null;
		}
	}

	async function removeMonitor(monitor: Monitor) {
		const action = `remove:${monitor.id}`;
		if (confirmingAction !== action) {
			confirmingAction = action;
			return;
		}
		confirmingAction = null;
		error = '';
		actingId = monitor.id;
		try {
			monitors = await invoke<Monitor[]>('remove_monitored_port', { id: monitor.id });
			selectedId = monitors[0]?.id ?? null;
			history =
				selectedId === null ? [] : await invoke<Sample[]>('get_metric_history', { id: selectedId });
		} catch (cause) {
			error = String(cause);
		} finally {
			actingId = null;
		}
	}

	function startRename(monitor: Monitor) {
		editingNameId = monitor.id;
		nameDraft = monitor.name ?? monitor.processName ?? '';
	}

	async function saveName(monitor: Monitor) {
		if (!nameDraft.trim()) {
			error = 'Process name cannot be empty.';
			return;
		}
		error = '';
		try {
			monitors = await invoke<Monitor[]>('rename_monitored_port', {
				id: monitor.id,
				name: nameDraft.trim()
			});
			editingNameId = null;
			showMessage('Process name updated');
		} catch (cause) {
			error = String(cause);
		}
	}

	function selectMonitor(monitor: Monitor) {
		selectedId = monitor.id;
		void loadHistory(monitor.id);
	}
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
		return timestamp ? formatChartTime(new Date(timestamp * 1000)) : 'No data yet';
	}
	function formatChartTime(value: Date) {
		return timeFormatter.format(value);
	}

	onMount(() => {
		let unlisten: UnlistenFn | undefined;
		void (async () => {
			await loadMonitors();
			unlisten = await listen<MonitorSnapshot>('monitor:update', async (event) => {
				monitors = event.payload.monitors;
				appMetrics = event.payload.appMetrics;
				if (selectedId !== null) await loadHistory(selectedId);
			});
		})();
		return () => {
			unlisten?.();
			if (messageTimer) clearTimeout(messageTimer);
		};
	});
</script>

<svelte:head><title>Port Monitor</title></svelte:head>

<main
	class="min-h-screen bg-[radial-gradient(circle_at_70%_0%,var(--color-canvas-glow)_0,var(--color-canvas)_38rem)] px-9 py-12 max-[1050px]:px-4 max-[1050px]:py-7 max-[480px]:px-3 max-[480px]:py-5"
>
	<div class="mx-auto w-full max-w-4xl">
		<header class="flex items-start justify-between gap-6 max-[600px]:flex-col">
			<h1
				class="mb-2 font-serif text-[38px] leading-tight font-semibold tracking-[-0.04em] text-foreground-strong"
			>
				Port Monitor
			</h1>
			<div
				class="flex flex-col items-end gap-3.5 max-[600px]:w-full max-[600px]:flex-row max-[600px]:items-center max-[600px]:justify-between max-[480px]:flex-col max-[480px]:items-start"
			>
				<div class="flex gap-3.5 text-[9px] tracking-[0.08em] text-muted">
					<span
						>APP CPU <strong class="ml-1 text-[10px] font-medium text-foreground-muted"
							>{formatCpu(appMetrics.cpuPercent)}</strong
						></span
					><span
						>APP RAM <strong class="ml-1 text-[10px] font-medium text-foreground-muted"
							>{formatMemory(appMetrics.memoryBytes)}</strong
						></span
					>
				</div>
				<div class="pt-2 text-[11px] tracking-[0.1em] text-primary">
					<span
						class="mr-1.5 inline-block size-1.5 rounded-full bg-success align-middle shadow-success-glow"
					></span>
					LIVE <small class="ml-1.5 tracking-normal text-muted-subtle">every 2 seconds</small>
				</div>
			</div>
		</header>

		<section
			class="my-6 grid grid-cols-3 overflow-hidden rounded border border-border bg-surface-raised/75"
			aria-label="Overview"
		>
			{#each [['MONITORED', monitors.length, 'port records'], ['RUNNING', onlineCount, 'processes online'], ['OFFLINE', monitors.length - onlineCount, 'records retained']] as stat, index (stat[0])}
				<div
					class={[
						'flex min-w-0 items-center justify-between gap-3 px-5 py-3',
						index > 0 && 'border-l border-border',
						index === 1 && 'bg-primary/10'
					]}
				>
					<div class="min-w-0">
						<span class="block text-[12px] tracking-[0.12em] text-foreground-strong">{stat[0]}</span
						>
						<small class="mt-1 block truncate text-[10px] text-muted">{stat[2]}</small>
					</div>
					<strong
						class={[
							'shrink-0 font-serif text-2xl leading-none font-medium',
							index === 1 ? 'text-success' : 'text-foreground-strong'
						]}>{stat[1]}</strong
					>
				</div>
			{/each}
		</section>

		<section class="grid grid-cols-1 items-start gap-[18px]">
			<div class="min-h-[420px] overflow-hidden rounded border border-border bg-surface/90">
				<div
					class="flex items-center justify-between border-b border-border-subtle px-[22px] pt-[22px] pb-[18px] max-[1050px]:flex-wrap max-[1050px]:gap-4"
				>
					<div>
						<p class="mb-2.5 text-[10px] tracking-[0.18em] text-primary">MONITORED PORTS</p>
						<h2 class="font-serif text-xl leading-tight font-semibold text-foreground-strong">
							Process list
						</h2>
					</div>
					<form class="flex gap-2 max-[1050px]:w-full max-[1050px]:flex-wrap" onsubmit={addPort}>
						<input
							class="w-[165px] rounded border border-border-control bg-surface-muted px-[11px] py-2.5 text-[11px] text-foreground outline-none placeholder:text-muted-subtle focus:border-primary focus:ring-2 focus:ring-primary/10 max-[1050px]:min-w-0 max-[1050px]:flex-1 max-[480px]:w-full max-[480px]:basis-full"
							aria-label="Port to monitor"
							type="number"
							min="1"
							max="65535"
							placeholder="Port, e.g. 3000"
							bind:value={portInput}
						/>
						<input
							class="w-[145px] rounded border border-border-control bg-surface-muted px-[11px] py-2.5 text-[11px] text-foreground outline-none placeholder:text-muted-subtle focus:border-primary focus:ring-2 focus:ring-primary/10 max-[1050px]:min-w-0 max-[1050px]:flex-1 max-[480px]:w-full max-[480px]:basis-full"
							aria-label="Optional name"
							type="text"
							maxlength="40"
							placeholder="Name (optional)"
							bind:value={nameInput}
						/>
						<button
							class="rounded bg-primary px-3.5 py-2.5 text-[11px] font-bold text-primary-foreground transition hover:bg-primary-hover hover:shadow-primary-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:w-full"
							type="submit"
							disabled={saving}>{saving ? '...' : '+ Add port'}</button
						>
					</form>
				</div>
				{#if message}<div
						class="mx-[22px] mt-3 rounded bg-success-surface px-3 py-2 text-[11px] break-words text-success max-[480px]:mx-3"
					>
						{message}
					</div>{/if}
				{#if error}<div
						class="mx-[22px] mt-3 rounded bg-danger-surface px-3 py-2 text-[11px] break-words text-danger max-[480px]:mx-3"
					>
						{error}
					</div>{/if}
				<div>
					<table class="w-full border-collapse text-left">
						<thead
							><tr class="text-[10px] font-normal tracking-[0.12em] text-muted"
								><th class="border-b border-border-subtle px-3 pt-4 pb-2.5 pl-[22px] font-normal"
									>PORT</th
								><th class="border-b border-border-subtle px-3 pt-4 pb-2.5 font-normal"
									>NAME / PROCESS</th
								><th class="border-b border-border-subtle px-3 pt-4 pb-2.5 font-normal">RAM</th><th
									class="border-b border-border-subtle px-3 pt-4 pb-2.5 font-normal">CPU</th
								><th class="border-b border-border-subtle px-3 pt-4 pb-2.5 font-normal">STATUS</th
								><th class="border-b border-border-subtle px-3 pt-4 pr-[18px] pb-2.5 font-normal"
								></th></tr
							></thead
						>
						<tbody>
							{#each monitors as monitor (monitor.id)}
								<tr
									class={[
										'border-b border-border-row text-xs text-foreground-muted transition-colors hover:bg-surface-selected',
										selected?.id === monitor.id && 'bg-surface-selected'
									]}
									onclick={() => selectMonitor(monitor)}
								>
									<td class="border-b border-border-row px-3 py-[15px] pl-[22px] align-middle"
										><button
											class="bg-transparent p-0 text-[15px] text-primary"
											onclick={(event) => {
												event.stopPropagation();
												selectMonitor(monitor);
											}}>{monitor.port}</button
										></td
									>
									<td class="min-w-0 border-b border-border-row px-3 py-[15px] align-middle"
										>{#if editingNameId === monitor.id}
											<form
												class="flex items-center gap-1.5"
												onsubmit={(event) => {
													event.preventDefault();
													event.stopPropagation();
													void saveName(monitor);
												}}
											>
												<input
													class="min-w-0 flex-1 rounded border border-primary bg-surface-muted px-2 py-1.5 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-primary/20"
													aria-label="New process name"
													maxlength="40"
													bind:value={nameDraft}
													onclick={(event) => event.stopPropagation()}
												/>
												<button
													class="inline-flex size-7 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-primary"
													type="submit"
													aria-label="Save process name"
													title="Save"
													onclick={(event) => event.stopPropagation()}
												>
													<Plus size={15} strokeWidth={2.5} />
												</button>
												<button
													class="inline-flex size-7 shrink-0 items-center justify-center rounded border border-border-strong text-muted-strong transition hover:border-danger hover:bg-danger-surface hover:text-danger-soft focus-visible:outline-2 focus-visible:outline-danger"
													type="button"
													aria-label="Cancel rename"
													title="Cancel"
													onclick={(event) => {
														event.stopPropagation();
														editingNameId = null;
													}}
												>
													<X size={15} strokeWidth={2.5} />
												</button>
											</form>
										{:else}
											<div class="flex items-center gap-2">
												<strong class="min-w-0 truncate text-xs font-medium text-foreground-strong"
													>{monitor.name ?? monitor.processName ?? '—'}</strong
												>
												<button
													class="inline-flex size-7 shrink-0 items-center justify-center rounded border border-transparent text-muted-strong transition hover:border-primary hover:bg-surface-hover hover:text-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
													type="button"
													aria-label="Rename process"
													title="Rename"
													onclick={(event) => {
														event.stopPropagation();
														startRename(monitor);
													}}
												>
													<Pencil size={14} strokeWidth={2} />
												</button>
											</div>
										{/if}
										<small class="mt-1.5 block truncate text-[10px] text-muted"
											>{monitor.name && monitor.processName
												? `${monitor.processName} · `
												: ''}{monitor.pid ? `PID ${monitor.pid}` : 'No process found'}</small
										></td
									>
									<td
										class="border-b border-border-row px-3 py-[15px] align-middle text-[11px] whitespace-nowrap text-foreground-muted"
										>{formatMemory(monitor.memoryBytes)}</td
									><td
										class="border-b border-border-row px-3 py-[15px] align-middle text-[11px] whitespace-nowrap text-foreground-muted"
										>{formatCpu(monitor.cpuPercent)}</td
									>
									<td class="border-b border-border-row px-3 py-[15px] align-middle"
										><span
											class={[
												'inline-flex items-center text-[10px] whitespace-nowrap',
												monitor.status === 'online' ? 'text-success' : 'text-danger'
											]}
											><i
												class={[
													'mr-1.5 inline-block size-1.5 rounded-full',
													monitor.status === 'online'
														? 'bg-success shadow-success-glow'
														: 'bg-danger-dot shadow-danger-glow'
												]}
											></i>{monitor.status === 'online' ? 'ONLINE' : 'OFFLINE'}</span
										></td
									>
									<td
										class="border-b border-border-row px-3 py-[15px] pr-[18px] text-right align-middle"
										><div class="flex flex-wrap justify-end gap-2">
											{#if monitor.pid && confirmingAction !== `remove:${monitor.id}`}<button
													class="rounded border border-danger-border bg-danger-control px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-danger-foreground transition hover:border-danger hover:bg-danger-hover hover:text-white hover:shadow-danger-action focus-visible:outline-2 focus-visible:outline-danger disabled:cursor-wait disabled:opacity-60"
													type="button"
													disabled={actingId === monitor.id}
													title="End process"
													onclick={(event) => {
														event.stopPropagation();
														void endProcess(monitor);
													}}
													>{actingId === monitor.id
														? '...'
														: confirmingAction === `end:${monitor.id}`
															? 'CONFIRM END'
															: 'END'}</button
												>{#if confirmingAction === `end:${monitor.id}`}
													<button
														class="rounded border border-border-strong bg-transparent px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-muted-strong transition hover:border-primary hover:text-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
														type="button"
														aria-label="Cancel ending process"
														onclick={(event) => {
															event.stopPropagation();
															confirmingAction = null;
														}}>CANCEL</button
													>
												{/if}{/if}{#if confirmingAction !== `end:${monitor.id}`}<button
													class="rounded border border-border-strong bg-surface-muted px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-muted-strong transition hover:border-danger hover:bg-danger-surface hover:text-danger-soft focus-visible:outline-2 focus-visible:outline-danger disabled:cursor-wait disabled:opacity-60"
													type="button"
													disabled={actingId === monitor.id}
													title="Remove monitor"
													onclick={(event) => {
														event.stopPropagation();
														void removeMonitor(monitor);
													}}
													>{actingId === monitor.id
														? '...'
														: confirmingAction === `remove:${monitor.id}`
															? 'CONFIRM REMOVE'
															: 'REMOVE'}</button
												>{#if confirmingAction === `remove:${monitor.id}`}
													<button
														class="rounded border border-border-strong bg-transparent px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-muted-strong transition hover:border-primary hover:text-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
														type="button"
														aria-label="Cancel removing monitor"
														onclick={(event) => {
															event.stopPropagation();
															confirmingAction = null;
														}}>CANCEL</button
													>
												{/if}
											{/if}
										</div>
									</td>
								</tr>
							{:else}<tr
									><td colspan="6" class="px-5 py-[60px] text-center text-muted"
										>No monitored ports yet. Add a port above to get started.</td
									></tr
								>{/each}
						</tbody>
					</table>
				</div>
			</div>

			<aside
				class="min-h-[420px] min-w-0 overflow-hidden rounded border border-border bg-surface/90 p-[22px] max-[1050px]:min-h-0 max-[480px]:p-3"
			>
				{#if selected}
					<div class="flex items-start justify-between">
						<div>
							<p class="mb-2.5 text-[10px] tracking-[0.18em] text-primary">PORT DETAIL</p>
							<h2 class="font-serif text-[29px] leading-tight font-semibold text-foreground-strong">
								{selected.port}
							</h2>
							<p class="mt-1.5 text-[10px] text-primary">
								{selected.name ?? selected.processName ?? 'Unnamed'}
							</p>
						</div>
						<span
							class={[
								'pt-1 text-[10px]',
								selected.status === 'online' ? 'text-success' : 'text-danger'
							]}
							><i
								class={[
									'mr-1.5 inline-block size-1.5 rounded-full',
									selected.status === 'online'
										? 'bg-success shadow-success-glow'
										: 'bg-danger-dot shadow-danger-glow'
								]}
							></i>{selected.status === 'online' ? 'ONLINE' : 'OFFLINE'}</span
						>
					</div>
					<div
						class="my-[22px] grid grid-cols-[1.2fr_0.7fr_1.4fr] gap-3 border-y border-border-subtle py-[15px]"
					>
						<div>
							<span class="text-[10px] tracking-[0.12em] text-muted">PROCESS</span><strong
								class="mt-1.5 block truncate text-[11px] text-foreground-muted"
								>{selected.processName ?? 'No listener found'}</strong
							>
						</div>
						<div>
							<span class="text-[10px] tracking-[0.12em] text-muted">PID</span><strong
								class="mt-1.5 block truncate text-[11px] text-foreground-muted"
								>{selected.pid ?? '—'}</strong
							>
						</div>
						<div>
							<span class="text-[10px] tracking-[0.12em] text-muted">LAST SAMPLE</span><strong
								class="mt-1.5 block truncate text-[11px] text-foreground-muted"
								>{formatTime(selected.observedAt)}</strong
							>
						</div>
					</div>
					<div class="mt-5">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[10px] tracking-[0.12em] text-muted">CPU USAGE</span><strong
								class="text-xs font-normal text-foreground-muted"
								>{formatCpu(selected.cpuPercent)}</strong
							>
						</div>
						<div
							class="h-[210px] overflow-hidden rounded bg-[linear-gradient(180deg,var(--color-surface-chart),transparent)] text-muted-strong"
						>
							<LineChart
								data={cpuChartData}
								x="date"
								y="value"
								highlight={{ points: false, lines: true }}
								height={210}
								padding={defaultChartPadding({ top: 10, right: 12, bottom: 28, left: 46 })}
								props={chartProps}
							/>
						</div>
						<small class="mt-1 block text-[9px] text-muted-subtle">X: time · Y: CPU (%)</small>
					</div>
					<div class="mt-5">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[10px] tracking-[0.12em] text-muted">RAM USAGE</span><strong
								class="text-xs font-normal text-foreground-muted"
								>{formatMemory(selected.memoryBytes)}</strong
							>
						</div>
						<div
							class="h-[210px] overflow-hidden rounded bg-[linear-gradient(180deg,var(--color-surface-chart),transparent)] text-muted-strong"
						>
							<LineChart
								data={ramChartData}
								x="date"
								y="value"
								highlight={{ points: false, lines: true }}
								height={210}
								padding={defaultChartPadding({ top: 10, right: 12, bottom: 28, left: 52 })}
								props={chartProps}
							/>
						</div>
						<small class="mt-1 block text-[9px] text-muted-subtle">X: time · Y: RAM (MB)</small>
					</div>
					<p class="mt-[15px] text-[10px] text-muted-subtle">
						{history.length} samples · retained by port even while the process is offline
					</p>
				{:else}<div class="px-5 pt-[90px] text-center text-muted">
						<span class="text-4xl text-primary">⌁</span>
						<h2 class="my-4 font-serif text-xl font-semibold text-foreground-strong">
							Select a port
						</h2>
						<p class="text-[11px]">RAM and CPU charts will appear here.</p>
					</div>{/if}
			</aside>
		</section>
	</div>
</main>
