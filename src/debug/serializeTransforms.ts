import type { Group } from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';

const rounded = (value: number): number => {
  const result = Number(value.toFixed(3));
  return Object.is(result, -0) ? 0 : result;
};

const tuple = (values: readonly number[]): string =>
  `[${values.map(rounded).join(', ')}]`;

export const serializeAssetTransform = (id: string, root: Group): string => `{
  id: ${JSON.stringify(id)},
  position: ${tuple(root.position.toArray())},
  rotation: ${tuple([root.rotation.x, root.rotation.y, root.rotation.z])},
  scale: ${tuple(root.scale.toArray())}
}`;

export const serializeLevelTransforms = (registry: AssetRegistry): string => {
  const transforms = registry
    .values()
    .map(({ config, root }) =>
      serializeAssetTransform(config.id, root)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
    );

  return transforms.length > 0 ? `[\n${transforms.join(',\n')}\n]` : '[]';
};
