import { LoadingManager, Mesh } from 'three';
import URDFLoader, { type URDFRobot } from 'urdf-loader';

export const GO2_PACKAGE_ROOT = '/models/go2/go2_description/';
export const GO2_URDF_URL =
  `${GO2_PACKAGE_ROOT}urdf/go2_description.urdf`;

export interface LoadedGo2Urdf {
  robot: URDFRobot;
  visualMeshCount: number;
}

export const loadOfficialGo2 = async (
  onProgress?: (loaded: number, total: number) => void,
): Promise<LoadedGo2Urdf> => {
  const failedResources: string[] = [];
  const manager = new LoadingManager();
  const resourcesLoaded = new Promise<void>((resolve) => {
    manager.onLoad = resolve;
  });
  manager.onError = (url) => {
    failedResources.push(url);
  };
  manager.onProgress = (_url, loaded, total) => {
    onProgress?.(loaded, total);
  };

  const loader = new URDFLoader(manager);
  loader.packages = {
    go2_description: GO2_PACKAGE_ROOT,
  };
  loader.parseVisual = true;
  loader.parseCollision = false;

  const robot = await loader.loadAsync(GO2_URDF_URL);
  await resourcesLoaded;

  if (failedResources.length > 0) {
    throw new Error(
      `Go2 URDF loaded with missing resources:\n${failedResources.join('\n')}`,
    );
  }

  let visualMeshCount = 0;
  robot.traverse((object) => {
    if (object instanceof Mesh) {
      visualMeshCount += 1;
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  if (visualMeshCount === 0) {
    throw new Error('The Go2 URDF loaded without any visual meshes.');
  }

  return { robot, visualMeshCount };
};
