import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  PointsMaterial,
  type Object3D,
} from 'three';

interface Particle {
  life: number;
  maxLife: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  dust: boolean;
}

const GAS_COLOR = new Color(0xdbe7e6);
const DUST_COLOR = new Color(0xa58d70);
const HIDDEN_Y = -10_000;

export class AirlockLeakParticles {
  readonly object: Points;

  private readonly origin: Object3D;
  private readonly particles: Particle[];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly positionAttribute: BufferAttribute;
  private readonly colorAttribute: BufferAttribute;
  private active = false;
  private emissionAccumulator = 0;
  private randomState = 0x5eeda11;

  constructor(origin: Object3D, count: number) {
    this.origin = origin;
    const particleCount = Math.max(30, Math.min(80, Math.round(count)));
    this.positions = new Float32Array(particleCount * 3);
    this.colors = new Float32Array(particleCount * 3);
    this.particles = Array.from({ length: particleCount }, () => ({
      life: 0,
      maxLife: 0,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      dust: false,
    }));

    for (let index = 0; index < particleCount; index += 1) {
      this.positions[index * 3 + 1] = HIDDEN_Y;
    }

    const geometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(this.positions, 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);
    this.colorAttribute = new BufferAttribute(this.colors, 3);
    this.colorAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('color', this.colorAttribute);

    this.object = new Points(
      geometry,
      new PointsMaterial({
        size: 0.065,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        sizeAttenuation: true,
        vertexColors: true,
      }),
    );
    this.object.name = 'airlock-lower-seal-leak-particles';
    this.object.frustumCulled = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.emissionAccumulator = 0;
    if (!active) {
      this.clear();
    }
  }

  update(deltaSeconds: number): void {
    if (!this.active) {
      return;
    }

    this.emissionAccumulator += deltaSeconds * this.particles.length * 2.4;
    while (this.emissionAccumulator >= 1) {
      this.spawnParticle();
      this.emissionAccumulator -= 1;
    }

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      if (particle.life <= 0) {
        continue;
      }

      particle.life = Math.max(0, particle.life - deltaSeconds);
      const offset = index * 3;
      if (particle.life === 0) {
        this.positions[offset + 1] = HIDDEN_Y;
        continue;
      }

      this.positions[offset] += particle.velocityX * deltaSeconds;
      this.positions[offset + 1] += particle.velocityY * deltaSeconds;
      this.positions[offset + 2] += particle.velocityZ * deltaSeconds;
      if (particle.dust) {
        particle.velocityY -= 0.35 * deltaSeconds;
      }

      const lifeRatio = particle.life / particle.maxLife;
      const color = particle.dust ? DUST_COLOR : GAS_COLOR;
      const intensity = lifeRatio * (particle.dust ? 0.65 : 0.9);
      this.colors[offset] = color.r * intensity;
      this.colors[offset + 1] = color.g * intensity;
      this.colors[offset + 2] = color.b * intensity;
    }

    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as PointsMaterial).dispose();
    this.object.removeFromParent();
  }

  private spawnParticle(): void {
    const index = this.particles.findIndex(({ life }) => life <= 0);
    if (index < 0) {
      return;
    }

    const particle = this.particles[index];
    const dust = this.random() < 0.36;
    particle.dust = dust;
    particle.maxLife = dust
      ? 0.45 + this.random() * 0.32
      : 0.22 + this.random() * 0.26;
    particle.life = particle.maxLife;
    particle.velocityX = (this.random() - 0.5) * (dust ? 0.8 : 1.45);
    particle.velocityY =
      (dust ? 0.08 : 0.16) + this.random() * (dust ? 0.36 : 0.62);
    particle.velocityZ =
      (dust ? 0.72 : 1.55) + this.random() * (dust ? 0.8 : 1.5);

    const offset = index * 3;
    this.positions[offset] = this.origin.position.x;
    this.positions[offset + 1] = this.origin.position.y;
    this.positions[offset + 2] = this.origin.position.z;
  }

  private clear(): void {
    for (let index = 0; index < this.particles.length; index += 1) {
      this.particles[index].life = 0;
      this.positions[index * 3 + 1] = HIDDEN_Y;
    }
    this.positionAttribute.needsUpdate = true;
  }

  private random(): number {
    this.randomState =
      (Math.imul(this.randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return this.randomState / 0x1_0000_0000;
  }
}
