import { Group, MathUtils } from 'three';
import type { Go2LegJoint } from '../go2/go2Joints';
import { DockablePanel } from '../ui/DockablePanel';

interface RangeRowOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

export class Go2DebugPanel {
  private readonly dock: DockablePanel;
  private readonly root: Group;
  private readonly joints: readonly Go2LegJoint[];
  private readonly resetters: Array<() => void> = [];

  constructor(
    host: HTMLElement,
    root: Group,
    joints: readonly Go2LegJoint[],
  ) {
    this.root = root;
    this.joints = joints;
    this.dock = new DockablePanel({
      id: 'go2-articulation',
      title: 'GO2 URDF ARTICULATION TEST',
      host,
      className: 'go2-panel',
      defaultMode: 'top-right',
    });

    const source = document.createElement('p');
    source.className = 'go2-panel__source';
    source.textContent =
      'Official Unitree URDF · 12 actuated joints detected from hierarchy';

    this.dock.body.append(source);
    this.buildRootSection();
    this.buildJointSections();

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'go2-panel__reset';
    resetButton.textContent = 'RESET TEST POSE';
    resetButton.addEventListener('click', () => {
      for (const reset of this.resetters) {
        reset();
      }
    });
    this.dock.body.append(resetButton);
  }

  dispose(): void {
    this.dock.dispose();
  }

  private buildRootSection(): void {
    const section = this.createSection('Robot root');

    const rootControls: RangeRowOptions[] = [
      {
        label: 'Position X',
        min: -3,
        max: 3,
        step: 0.01,
        value: this.root.position.x,
        format: (value) => value.toFixed(2),
        onChange: (value) => {
          this.root.position.x = value;
        },
      },
      {
        label: 'Position Y',
        min: 0,
        max: 2,
        step: 0.01,
        value: this.root.position.y,
        format: (value) => value.toFixed(2),
        onChange: (value) => {
          this.root.position.y = value;
        },
      },
      {
        label: 'Position Z',
        min: -3,
        max: 3,
        step: 0.01,
        value: this.root.position.z,
        format: (value) => value.toFixed(2),
        onChange: (value) => {
          this.root.position.z = value;
        },
      },
      ...(['x', 'y', 'z'] as const).map((axis) => ({
        label: `Rotation ${axis.toUpperCase()}`,
        min: -180,
        max: 180,
        step: 1,
        value: MathUtils.radToDeg(this.root.rotation[axis]),
        format: (value: number) => `${value.toFixed(0)}°`,
        onChange: (value: number) => {
          this.root.rotation[axis] = MathUtils.degToRad(value);
        },
      })),
      ...(['x', 'y', 'z'] as const).map((axis) => ({
        label: `Scale ${axis.toUpperCase()}`,
        min: 0.25,
        max: 3,
        step: 0.01,
        value: this.root.scale[axis],
        format: (value: number) => value.toFixed(2),
        onChange: (value: number) => {
          this.root.scale[axis] = value;
        },
      })),
    ];

    rootControls.forEach((options) => {
      section.append(this.createRangeRow(options));
    });
  }

  private buildJointSections(): void {
    const legOrder = [
      'front-right',
      'front-left',
      'rear-right',
      'rear-left',
    ] as const;

    for (const leg of legOrder) {
      const entries = this.joints.filter(({ leg: value }) => value === leg);
      const section = this.createSection(entries[0].legLabel);

      for (const entry of entries) {
        const value = entry.joint.angle;
        const lower = Number.isFinite(entry.joint.limit.lower)
          ? entry.joint.limit.lower
          : -Math.PI;
        const upper = Number.isFinite(entry.joint.limit.upper)
          ? entry.joint.limit.upper
          : Math.PI;

        section.append(
          this.createRangeRow({
            label: `${entry.roleLabel} · ${entry.name}`,
            min: lower,
            max: upper,
            step: 0.005,
            value,
            format: (angle) => `${MathUtils.radToDeg(angle).toFixed(1)}°`,
            onChange: (angle) => {
              entry.joint.setJointValue(angle);
            },
          }),
        );
      }
    }
  }

  private createSection(titleText: string): HTMLElement {
    const section = document.createElement('details');
    section.className = 'go2-panel__section';
    section.open = true;

    const title = document.createElement('summary');
    title.textContent = titleText;
    section.append(title);
    this.dock.body.append(section);
    return section;
  }

  private createRangeRow(options: RangeRowOptions): HTMLElement {
    const row = document.createElement('label');
    row.className = 'go2-range';

    const header = document.createElement('span');
    header.className = 'go2-range__header';

    const name = document.createElement('span');
    name.textContent = options.label;

    const valueLabel = document.createElement('output');
    valueLabel.textContent = options.format(options.value);
    header.append(name, valueLabel);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step);
    input.value = String(options.value);

    const setValue = (value: number): void => {
      input.value = String(value);
      valueLabel.textContent = options.format(value);
      options.onChange(value);
    };

    input.addEventListener('input', () => {
      setValue(Number(input.value));
    });
    this.resetters.push(() => setValue(options.value));

    row.append(header, input);
    return row;
  }
}
