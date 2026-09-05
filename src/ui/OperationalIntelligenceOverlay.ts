import type { OntologyStore } from '../ontology/OntologyStore';
import type {
  OntologyObject,
  OntologyRelation,
  OntologySnapshot,
} from '../ontology/types';
import { DockablePanel } from './DockablePanel';

interface GraphNodeLayout {
  object: OntologyObject;
  depth: number;
  x: number;
  y: number;
}

interface GraphLayout {
  nodes: readonly GraphNodeLayout[];
  relations: readonly OntologyRelation[];
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const formatState = (value: string): string =>
  value.replaceAll('_', ' ');

const formatConfidence = (confidence: number | undefined): string =>
  confidence === undefined ? '—' : `${Math.round(confidence * 100)}%`;

const getObject = (
  snapshot: OntologySnapshot,
  id: string,
): OntologyObject | undefined =>
  snapshot.objects.find((object) => object.id === id);

const getRoleOrTask = (object: OntologyObject): string =>
  object.properties.role ??
  object.properties.currentTask ??
  object.description ??
  object.type;

const isSpatialObject = (object: OntologyObject): boolean =>
  object.properties.position !== undefined &&
  object.type !== 'Observation' &&
  object.type !== 'TelemetryReport' &&
  object.type !== 'Alert';

const getGraphLayout = (
  snapshot: OntologySnapshot,
  selectedId: string,
): GraphLayout => {
  const selected = getObject(snapshot, selectedId);
  if (!selected) {
    return { nodes: [], relations: [] };
  }

  const depths = new Map<string, number>([[selectedId, 0]]);
  let frontier = [selectedId];
  for (let depth = 0; depth < 3 && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const item of snapshot.relations) {
        const connectedId =
          item.from === id ? item.to : item.to === id ? item.from : null;
        if (
          !connectedId ||
          depths.has(connectedId) ||
          !getObject(snapshot, connectedId)
        ) {
          continue;
        }
        depths.set(connectedId, depth + 1);
        next.push(connectedId);
        if (depths.size >= 9) {
          break;
        }
      }
      if (depths.size >= 9) {
        break;
      }
    }
    frontier = next;
  }

  const nodes: GraphNodeLayout[] = [];
  for (let depth = 0; depth <= 3; depth += 1) {
    const ids = [...depths.entries()]
      .filter(([, nodeDepth]) => nodeDepth === depth)
      .map(([id]) => id);
    ids.forEach((id, index) => {
      const object = getObject(snapshot, id);
      if (!object) {
        return;
      }
      nodes.push({
        object,
        depth,
        x: [9, 35, 63, 89][depth] ?? 89,
        y: depth === 0 ? 50 : ((index + 1) / (ids.length + 1)) * 100,
      });
    });
  }

  const nodeIds = new Set(nodes.map(({ object }) => object.id));
  const relations = snapshot.relations.filter(
    (item) => nodeIds.has(item.from) && nodeIds.has(item.to),
  );
  return { nodes, relations };
};

const SECTION_STORAGE_KEY = 'moontology.ops.sections.v1';

const loadCollapsedSections = (): Record<string, boolean> => {
  try {
    const raw = window.localStorage.getItem(SECTION_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
};

export class OperationalIntelligenceOverlay {
  private readonly store: OntologyStore;
  private readonly dock: DockablePanel;
  private readonly element: HTMLElement;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeDock: () => void;
  private snapshot: OntologySnapshot;
  private expanded = true;
  private collapsedSections = loadCollapsedSections();

  constructor(host: HTMLElement, store: OntologyStore) {
    this.store = store;
    this.snapshot = store.getSnapshot();
    this.dock = new DockablePanel({
      id: 'ops-intelligence',
      title: 'OPERATIONAL INTELLIGENCE',
      host,
      className: 'ops-intelligence',
      collapsedClass: 'ops-intelligence--collapsed',
      ariaLabel: 'Lunar base operational intelligence',
      variant: 'ops',
      fillHeight: true,
      defaultMode: 'top-left',
      defaultCollapsed: true,
      persist: false,
      zBase: 40,
      useCollapsedSlot: true,
    });
    this.element = this.dock.root;
    this.expanded = !this.dock.isCollapsed;
    this.element.addEventListener('click', this.handleClick);
    this.unsubscribeDock = this.dock.subscribe(() => {
      if (this.expanded === !this.dock.isCollapsed) {
        return;
      }
      this.expanded = !this.dock.isCollapsed;
      this.render();
    });
    this.unsubscribe = store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.render();
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.unsubscribeDock();
    this.element.removeEventListener('click', this.handleClick);
    this.dock.dispose();
  }

  private render(): void {
    this.element.dataset.expanded = String(this.expanded);
    if (this.expanded) {
      this.dock.body.innerHTML = this.renderExpanded();
      return;
    }
    this.dock.collapsedHost.innerHTML = this.renderCollapsed();
  }

  private renderCollapsed(): string {
    const { fleet, mission } = this.snapshot;
    const alert = this.snapshot.objects.find(
      (object) =>
        object.type === 'Alert' && object.properties.status !== 'MITIGATED',
    );
    const go2 = getObject(this.snapshot, 'GO2-01');
    return `
      <div class="ops-rail">
        <div class="ops-rail__mark" aria-hidden="true">M</div>
        <div class="ops-rail__mission">
          <span>MISSION</span>
          <strong>${escapeHtml(mission.id)}</strong>
          <small>${escapeHtml(mission.scene)}</small>
        </div>
        <div class="ops-rail__metric ${fleet.state !== 'NOMINAL' ? 'is-attention' : ''}">
          <span>FLEET</span>
          <strong>${fleet.nominal}/${fleet.total}</strong>
          <small>${escapeHtml(fleet.state)}</small>
        </div>
        <div class="ops-rail__metric ${alert ? 'is-alert' : ''}">
          <span>ALERT</span>
          <strong>${alert ? '01' : '00'}</strong>
          <small>${escapeHtml(alert?.properties.subjectId ?? 'CLEAR')}</small>
        </div>
        <div class="ops-rail__metric">
          <span>GO2</span>
          <strong class="ops-rail__go2-dot" aria-hidden="true"></strong>
          <small>${escapeHtml(go2?.properties.status ?? 'OFFLINE')}</small>
        </div>
        <button class="ops-rail__expand" type="button" data-command="toggle">
          <span>EXPAND</span>
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    `;
  }

  private renderExpanded(): string {
    const selected = getObject(
      this.snapshot,
      this.snapshot.selectedEntityId,
    );
    if (!selected) {
      return '';
    }
    const openAlertCount = this.snapshot.objects.filter(
      (object) =>
        object.type === 'Alert' && object.properties.status !== 'MITIGATED',
    ).length;
    const go2 = getObject(this.snapshot, 'GO2-01');

    return `
      <div class="ops-console">
        <header class="ops-header">
          <div>
            <div class="ops-eyebrow">
              <span class="ops-live-dot"></span>
              OPERATIONAL INTELLIGENCE / ${escapeHtml(this.snapshot.mission.phase)}
            </div>
            <h1>${escapeHtml(this.snapshot.mission.label)}</h1>
            <p>${escapeHtml(this.snapshot.mission.scene)} · spatial truth synchronized</p>
          </div>
          <div class="ops-header__actions">
            <span class="ops-status-pill">${this.snapshot.fleet.nominal}/${this.snapshot.fleet.total} NOMINAL</span>
            <span class="ops-status-pill ${openAlertCount > 0 ? 'is-alert' : ''}">
              ${openAlertCount.toString().padStart(2, '0')} OPEN ALERT
            </span>
            <button type="button" data-command="toggle" aria-label="Collapse operational intelligence">
              <span>COLLAPSE</span>
              <span aria-hidden="true">↙</span>
            </button>
          </div>
        </header>

        <div class="ops-context-strip">
          <div><span>MISSION</span><strong>${escapeHtml(this.snapshot.mission.id)}</strong></div>
          <div><span>SELECTED OBJECT</span><strong>${escapeHtml(selected.id)}</strong></div>
          <div><span>OBJECT TYPE</span><strong>${escapeHtml(selected.type)}</strong></div>
          <div><span>GO2 STATE</span><strong>${escapeHtml(go2?.properties.status ?? 'OFFLINE')}</strong></div>
          <div><span>ONTOLOGY REV</span><strong>${String(this.snapshot.revision).padStart(3, '0')}</strong></div>
        </div>

        <div class="ops-scroll">
          <details class="ops-section ops-section--map" data-section="map" ${this.sectionOpenAttr('map')}>
            <summary class="ops-section__heading">
              ${this.renderSectionHeading(
                '01',
                'Operations map',
                'World coordinates / X–Z plane',
                'ops-map-title',
              )}
            </summary>
            <div class="ops-section__body">
              ${this.renderMap()}
            </div>
          </details>

          <details class="ops-section" data-section="graph" ${this.sectionOpenAttr('graph')}>
            <summary class="ops-section__heading">
              ${this.renderSectionHeading(
                '02',
                'Object / relation graph',
                `${selected.id} operational neighborhood`,
                'ops-graph-title',
              )}
            </summary>
            <div class="ops-section__body">
              ${this.renderRelationGraph()}
            </div>
          </details>

          <details class="ops-section" data-section="evidence" ${this.sectionOpenAttr('evidence')}>
            <summary class="ops-section__heading">
              ${this.renderSectionHeading(
                '03',
                'Evidence / state comparison',
                'Plan vs telemetry vs physical truth',
                'ops-evidence-title',
              )}
            </summary>
            <div class="ops-section__body">
              ${this.renderEvidence()}
            </div>
          </details>

          <details class="ops-section" data-section="impact" ${this.sectionOpenAttr('impact')}>
            <summary class="ops-section__heading">
              ${this.renderSectionHeading(
                '04',
                'Dependency impact',
                'Derived from ontology relationships',
                'ops-impact-title',
              )}
            </summary>
            <div class="ops-section__body">
              ${this.renderImpact()}
            </div>
          </details>

          <details class="ops-section" data-section="trace" ${this.sectionOpenAttr('trace')}>
            <summary class="ops-section__heading">
              ${this.renderSectionHeading(
                '05',
                'Decision / action trace',
                'Observations and actions remain distinct',
                'ops-trace-title',
              )}
            </summary>
            <div class="ops-section__body">
              ${this.renderTrace()}
            </div>
          </details>
        </div>
      </div>
    `;
  }

  private renderSectionHeading(
    index: string,
    title: string,
    description: string,
    id: string,
  ): string {
    return `
        <span>${index}</span>
        <div>
          <h2 id="${id}">${title}</h2>
          <p>${description}</p>
        </div>
    `;
  }

  private sectionOpenAttr(id: string): string {
    return this.collapsedSections[id] ? '' : 'open';
  }

  private persistCollapsedSections(): void {
    try {
      window.localStorage.setItem(
        SECTION_STORAGE_KEY,
        JSON.stringify(this.collapsedSections),
      );
    } catch {
      // Ignore storage failures.
    }
  }

  private renderMap(): string {
    const { minX, maxX, minZ, maxZ } = this.snapshot.mission.worldBounds;
    const spatialObjects = this.snapshot.objects.filter(isSpatialObject);
    const point = (object: OntologyObject): { x: number; y: number } => {
      const position = object.properties.position;
      if (!position) {
        return { x: 50, y: 50 };
      }
      return {
        x: ((position.x - minX) / (maxX - minX)) * 100,
        y: 100 - ((position.z - minZ) / (maxZ - minZ)) * 100,
      };
    };
    const zones = spatialObjects
      .filter((object) => object.properties.footprint)
      .map((object) => {
        const position = point(object);
        const footprint = object.properties.footprint;
        if (!footprint) {
          return '';
        }
        const width = (footprint.width / (maxX - minX)) * 100;
        const height = (footprint.depth / (maxZ - minZ)) * 100;
        return `
          <button
            type="button"
            class="ops-map__zone ops-map__zone--${object.type.toLowerCase()} ${this.snapshot.selectedEntityId === object.id ? 'is-selected' : ''}"
            style="left:${position.x}%;top:${position.y}%;width:${width}%;height:${height}%"
            data-entity-id="${escapeHtml(object.id)}"
            aria-label="Select ${escapeHtml(object.label)}"
          >
            <span>${escapeHtml(object.id)}</span>
          </button>
        `;
      })
      .join('');

    const mapRelations = this.snapshot.relations
      .filter((item) => {
        const from = getObject(this.snapshot, item.from);
        const to = getObject(this.snapshot, item.to);
        return (
          from &&
          to &&
          isSpatialObject(from) &&
          isSpatialObject(to) &&
          (item.type === 'locatedAt' ||
            item.type === 'routesThrough' ||
            item.type === 'supplies')
        );
      })
      .map((item) => {
        const from = getObject(this.snapshot, item.from);
        const to = getObject(this.snapshot, item.to);
        if (!from || !to) {
          return '';
        }
        const start = point(from);
        const end = point(to);
        return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" class="ops-map__relation ops-map__relation--${item.type}" />`;
      })
      .join('');

    const nodes = spatialObjects
      .filter((object) => !object.properties.footprint)
      .map((object) => {
        const position = point(object);
        const isSelected = this.snapshot.selectedEntityId === object.id;
        const isDiscrepancy = this.snapshot.discrepancyIds.includes(object.id);
        return `
          <button
            type="button"
            class="ops-map__entity ops-map__entity--${object.type.toLowerCase()} ${isSelected ? 'is-selected' : ''} ${isDiscrepancy ? 'is-discrepancy' : ''}"
            style="left:${position.x}%;top:${position.y}%"
            data-entity-id="${escapeHtml(object.id)}"
            aria-label="Select ${escapeHtml(object.label)}"
          >
            <span class="ops-map__glyph" aria-hidden="true">${this.getMapGlyph(object.type)}</span>
            <span class="ops-map__label">
              <strong>${escapeHtml(object.id)}</strong>
              <small>${escapeHtml(getRoleOrTask(object))}</small>
              <em>${escapeHtml(object.properties.health ?? object.properties.status)}</em>
            </span>
          </button>
        `;
      })
      .join('');

    return `
      <div class="ops-map">
        <div class="ops-map__axis ops-map__axis--x">X ${minX}m <span>${maxX}m</span></div>
        <div class="ops-map__axis ops-map__axis--z">Z ${maxZ}m <span>${minZ}m</span></div>
        <svg class="ops-map__relations" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${mapRelations}
        </svg>
        ${zones}
        ${nodes}
        <div class="ops-map__legend">
          <span><i class="is-nominal"></i> nominal</span>
          <span><i class="is-selected"></i> selected</span>
          <span><i class="is-discrepancy"></i> discrepancy</span>
        </div>
      </div>
    `;
  }

  private renderRelationGraph(): string {
    const layout = getGraphLayout(
      this.snapshot,
      this.snapshot.selectedEntityId,
    );
    const byId = new Map(
      layout.nodes.map((node) => [node.object.id, node]),
    );
    const lines = layout.relations
      .map((item) => {
        const from = byId.get(item.from);
        const to = byId.get(item.to);
        if (!from || !to) {
          return '';
        }
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        return `
          <g>
            <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" marker-end="url(#ops-arrow)" />
            <text x="${midX}" y="${midY - 2}">${escapeHtml(item.type)}</text>
          </g>
        `;
      })
      .join('');
    const nodes = layout.nodes
      .map(({ object, x, y, depth }) => {
        const isDiscrepancy = this.snapshot.discrepancyIds.includes(object.id);
        return `
          <button
            type="button"
            class="ops-graph__node ${depth === 0 ? 'is-root' : ''} ${isDiscrepancy ? 'is-discrepancy' : ''}"
            style="left:${x}%;top:${y}%"
            data-entity-id="${escapeHtml(object.id)}"
          >
            <span>${escapeHtml(object.type)}</span>
            <strong>${escapeHtml(object.id)}</strong>
            <small>${escapeHtml(object.properties.status)}</small>
          </button>
        `;
      })
      .join('');

    return `
      <div class="ops-graph">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="ops-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z"></path>
            </marker>
          </defs>
          ${lines}
        </svg>
        ${nodes}
      </div>
    `;
  }

  private renderEvidence(): string {
    const { evidence } = this.snapshot.analysis;
    const cells = [
      ['EXPECTED', evidence.expected, 'plan'],
      ['REPORTED', evidence.reported, 'reported'],
      ['OBSERVED', evidence.observed, 'observed'],
    ] as const;
    return `
      <div class="ops-evidence">
        ${cells
          .map(
            ([label, item, className]) => `
              <article class="ops-evidence__cell ops-evidence__cell--${className}">
                <header>
                  <span>${label}</span>
                  <small>${escapeHtml(item.source)}</small>
                </header>
                <strong>${escapeHtml(formatState(item.state))}</strong>
                <p>${escapeHtml(formatState(item.detail))}</p>
                ${
                  label === 'EXPECTED'
                    ? '<em>PLAN AUTHORITY</em>'
                    : `<em>CONFIDENCE ${formatConfidence(item.confidence)}</em>`
                }
              </article>
            `,
          )
          .join('')}
        <div class="ops-evidence__result ${evidence.result === 'DISCREPANCY' ? 'is-discrepancy' : 'is-aligned'}">
          <span>RESULT</span>
          <strong>${evidence.result}</strong>
          <small>${evidence.result === 'DISCREPANCY' ? 'Reported state is not supported by physical progress' : 'Evidence channels agree'}</small>
        </div>
      </div>
    `;
  }

  private renderImpact(): string {
    const selected = getObject(
      this.snapshot,
      this.snapshot.selectedEntityId,
    );
    if (!selected) {
      return '';
    }
    const entries = [
      {
        objectId: selected.id,
        label: selected.label,
        state: selected.properties.health ?? selected.properties.status,
      },
      ...this.snapshot.analysis.intelligence.downstreamImpact,
    ];
    if (entries.length === 1) {
      return `
        <div class="ops-empty-state">
          No affected downstream relationship is derived for this object.
        </div>
      `;
    }
    return `
      <div class="ops-impact">
        ${entries
          .map(
            (entry, index) => `
              <div class="ops-impact__step ${index === 0 ? 'is-source' : ''}">
                ${entry.relation ? `<span>${escapeHtml(entry.relation)}</span>` : '<span>source</span>'}
                <strong>${escapeHtml(entry.objectId)}</strong>
                <small>${escapeHtml(formatState(entry.state))}</small>
              </div>
              ${index < entries.length - 1 ? '<div class="ops-impact__arrow" aria-hidden="true">→</div>' : ''}
            `,
          )
          .join('')}
      </div>
    `;
  }

  private renderTrace(): string {
    const selected = getObject(
      this.snapshot,
      this.snapshot.selectedEntityId,
    );
    if (!selected) {
      return '';
    }
    const intelligence = this.snapshot.analysis.intelligence;
    const replacementId = intelligence.replacementCandidates[0];
    const verificationStatus = selected.properties.verificationStatus;
    const taskId = selected.properties.currentTask;
    let actionControl = `
      <div class="ops-trace__resolved">
        <span>NO ACTION REQUIRED</span>
        <strong>Monitoring continues</strong>
      </div>
    `;

    if (intelligence.discrepancy && verificationStatus === 'REQUIRED') {
      actionControl = `
        <button type="button" class="ops-primary-action" data-command="request-verification">
          <span>RECOMMENDED ACTION</span>
          <strong>Request Go2 physical inspection</strong>
          <em>EXECUTE →</em>
        </button>
      `;
    } else if (verificationStatus === 'REQUESTED') {
      actionControl = `
        <button type="button" class="ops-primary-action is-verification" data-command="confirm-verification">
          <span>DETERMINISTIC DEMO TRIGGER</span>
          <strong>Confirm Go2 observation</strong>
          <em>VERIFY →</em>
        </button>
      `;
    } else if (
      intelligence.discrepancy &&
      verificationStatus === 'CONFIRMED' &&
      replacementId &&
      taskId
    ) {
      actionControl = `
        <button type="button" class="ops-primary-action" data-command="reassign-task">
          <span>RECOMMENDED ACTION</span>
          <strong>Reassign ${escapeHtml(taskId)} to ${escapeHtml(replacementId)}</strong>
          <em>EXECUTE →</em>
        </button>
      `;
    } else if (verificationStatus === 'CONFIRMED') {
      actionControl = `
        <div class="ops-trace__resolved">
          <span>ACTION EXECUTED</span>
          <strong>${escapeHtml(this.snapshot.actions.at(-1)?.summary ?? 'Mitigation recorded')}</strong>
        </div>
      `;
    }

    const actionIds = new Set(this.snapshot.actions.map((action) => action.id));
    return `
      <div class="ops-trace">
        <div class="ops-trace__timeline">
          ${this.snapshot.trace
            .map(
              (entry, index) => `
                <div class="ops-trace__event ops-trace__event--${entry.kind} ${entry.status === 'active' ? 'is-active' : ''}">
                  <span class="ops-trace__index">${String(index + 1).padStart(2, '0')}</span>
                  <i aria-hidden="true"></i>
                  <div>
                    <small>${escapeHtml(entry.kind.toUpperCase())} · ${escapeHtml(entry.timestamp)}</small>
                    <strong>${escapeHtml(entry.label)}</strong>
                  </div>
                </div>
              `,
            )
            .join('')}
          ${
            actionIds.size > 0
              ? `<div class="ops-action-ledger">
                  <span>ACTION LEDGER</span>
                  ${this.snapshot.actions
                    .slice(-2)
                    .map(
                      (action) => `
                        <div>
                          <strong>${escapeHtml(action.type)}</strong>
                          <small>${escapeHtml(action.actorId)} · ${escapeHtml(action.status)}</small>
                        </div>
                      `,
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>
        ${actionControl}
      </div>
    `;
  }

  private getMapGlyph(type: OntologyObject['type']): string {
    const glyphs: Partial<Record<OntologyObject['type'], string>> = {
      Humanoid: 'H',
      Go2: 'G',
      Rover: 'R',
      Excavator: 'E',
      CableRover: 'C',
      PowerNode: 'P',
      CableRun: '═',
      Airlock: 'A',
      CargoContainer: '□',
    };
    return glyphs[type] ?? '•';
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const commandElement = target.closest<HTMLElement>('[data-command]');
    const command = commandElement?.dataset.command;
    const section = target.closest<HTMLDetailsElement>('details[data-section]');
    if (section && target.closest('summary')) {
      window.setTimeout(() => {
        const sectionId = section.dataset.section;
        if (!sectionId) {
          return;
        }
        this.collapsedSections[sectionId] = !section.open;
        this.persistCollapsedSections();
      }, 0);
      return;
    }
    if (command === 'toggle') {
      this.dock.setCollapsed(!this.dock.isCollapsed);
      return;
    }
    if (command === 'request-verification') {
      this.store.requestVerification(this.snapshot.selectedEntityId, 'GO2-01');
      return;
    }
    if (command === 'confirm-verification') {
      this.store.confirmVerification({
        observerId: 'GO2-01',
        subjectId: this.snapshot.selectedEntityId,
        state: 'OFF_TASK / NO_PROGRESS',
        behavior: 'REPETITIVE_OFF_TASK_MOTION',
        confidence: 0.98,
        note: 'Go2 visual inspection confirms repetitive off-task motion and zero cable deployment progress.',
      });
      return;
    }
    if (command === 'reassign-task') {
      const selected = getObject(
        this.snapshot,
        this.snapshot.selectedEntityId,
      );
      const replacementId =
        this.snapshot.analysis.intelligence.replacementCandidates[0];
      if (selected?.properties.currentTask && replacementId) {
        this.store.executeOntologyAction({
          type: 'reassignTask',
          targetId: selected.id,
          actorId: 'MISSION-CONTROL',
          parameters: {
            replacementId,
            taskId: selected.properties.currentTask,
          },
        });
      }
      return;
    }

    const entityElement = target.closest<HTMLElement>('[data-entity-id]');
    const entityId = entityElement?.dataset.entityId;
    if (entityId) {
      this.store.selectEntity(entityId);
    }
  };
}
