import type { URDFJoint, URDFRobot } from 'urdf-loader';

export type LegKey =
  | 'front-right'
  | 'front-left'
  | 'rear-right'
  | 'rear-left';

export type JointRole = 'hip' | 'thigh' | 'calf';

export interface Go2LegJoint {
  leg: LegKey;
  legLabel: string;
  role: JointRole;
  roleLabel: string;
  name: string;
  joint: URDFJoint;
}

const legDefinitions: ReadonlyArray<{
  key: LegKey;
  label: string;
  abbreviations: readonly string[];
  words: readonly string[];
}> = [
  {
    key: 'front-right',
    label: 'Front Right',
    abbreviations: ['fr', 'rf'],
    words: ['front', 'right'],
  },
  {
    key: 'front-left',
    label: 'Front Left',
    abbreviations: ['fl', 'lf'],
    words: ['front', 'left'],
  },
  {
    key: 'rear-right',
    label: 'Rear Right',
    abbreviations: ['rr', 'rh'],
    words: ['rear', 'right'],
  },
  {
    key: 'rear-left',
    label: 'Rear Left',
    abbreviations: ['rl', 'lh'],
    words: ['rear', 'left'],
  },
];

const roleDefinitions: ReadonlyArray<{
  role: JointRole;
  label: string;
  aliases: readonly string[];
}> = [
  { role: 'hip', label: 'Hip', aliases: ['hip'] },
  { role: 'thigh', label: 'Thigh', aliases: ['thigh', 'upperleg'] },
  { role: 'calf', label: 'Calf', aliases: ['calf', 'lowerleg', 'knee'] },
];

const tokenize = (name: string): string[] =>
  name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const matchesLeg = (
  tokens: readonly string[],
  definition: (typeof legDefinitions)[number],
): boolean =>
  definition.abbreviations.some((value) => tokens.includes(value)) ||
  definition.words.every((value) => tokens.includes(value));

export const identifyGo2LegJoints = (robot: URDFRobot): Go2LegJoint[] => {
  const revoluteJoints = Object.entries(robot.joints).filter(
    ([, joint]) =>
      joint.jointType === 'revolute' || joint.jointType === 'continuous',
  );
  const identified: Go2LegJoint[] = [];
  const errors: string[] = [];

  for (const leg of legDefinitions) {
    for (const role of roleDefinitions) {
      const matches = revoluteJoints.filter(([name]) => {
        const tokens = tokenize(name);
        return (
          matchesLeg(tokens, leg) &&
          role.aliases.some((alias) => tokens.includes(alias))
        );
      });

      if (matches.length !== 1) {
        errors.push(
          `${leg.label} ${role.label}: expected 1 match, found ${matches.length}`,
        );
        continue;
      }

      const [name, joint] = matches[0];
      identified.push({
        leg: leg.key,
        legLabel: leg.label,
        role: role.role,
        roleLabel: role.label,
        name,
        joint,
      });
    }
  }

  if (errors.length > 0 || identified.length !== 12) {
    const loadedNames = revoluteJoints.map(([name]) => name).join(', ');
    throw new Error(
      `Could not identify all 12 primary Go2 leg joints.\n${errors.join('\n')}\nLoaded actuated joints: ${loadedNames}`,
    );
  }

  return identified;
};

export const getNeutralJointAngle = ({
  role,
  joint,
}: Go2LegJoint): number => {
  const desired = role === 'hip' ? 0 : role === 'thigh' ? 0.8 : -1.55;
  return Math.min(joint.limit.upper, Math.max(joint.limit.lower, desired));
};

export const logGo2LegJoints = (joints: readonly Go2LegJoint[]): void => {
  console.group('[go2] 12 primary actuated leg joints');

  for (const leg of legDefinitions) {
    console.group(leg.label);
    for (const entry of joints.filter(({ leg: key }) => key === leg.key)) {
      console.info(`${entry.roleLabel}: ${entry.name}`, {
        axis: entry.joint.axis.toArray(),
        lower: entry.joint.limit.lower,
        upper: entry.joint.limit.upper,
        parent: entry.joint.parent?.name,
      });
    }
    console.groupEnd();
  }

  console.groupEnd();
};
