import { Box, Text } from "@opentui/core";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  char: string;
  life: number;
  maxLife: number;
}

const DEBRIS_CHARS = ["█", "▓", "▒", "░", "▄", "▀", "■", "▪", "◼"];
const SPARK_CHARS = ["*", "✦", "✧", "•", "·", "+", "×"];

const FIRE_COLORS = [
  "#FFFFFF",
  "#FFFF44",
  "#FFDD00",
  "#FFAA00",
  "#FF7700",
  "#FF4400",
  "#DD2200",
  "#AA0000",
  "#660000",
  "#330000",
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export class ExplosionAnimation {
  private particles: Particle[] = [];
  private frame = 0;
  private readonly maxFrames: number;
  private readonly width: number;
  private readonly height: number;

  public constructor(width: number, height: number) {
    this.width = Math.max(10, width);
    this.height = Math.max(5, height);
    this.maxFrames = 25;
    this.initParticles();
  }

  private initParticles(): void {
    const numDebris = Math.min(80, Math.floor((this.width * this.height) / 10));
    const numSparks = Math.min(60, Math.floor(numDebris * 0.7));
    const cx = this.width / 2;
    const cy = this.height / 2;

    for (let i = 0; i < numDebris; i++) {
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      const angle = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.8;
      const speed = 0.3 + Math.random() * 1.5;
      const maxLife = 12 + Math.floor(Math.random() * 12);

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5 - 0.3,
        char: pickRandom(DEBRIS_CHARS),
        life: maxLife,
        maxLife,
      });
    }

    for (let i = 0; i < numSparks; i++) {
      const x = cx + (Math.random() - 0.5) * this.width * 0.6;
      const y = cy + (Math.random() - 0.5) * this.height * 0.6;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      const maxLife = 6 + Math.floor(Math.random() * 10);

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5 - 0.5,
        char: pickRandom(SPARK_CHARS),
        life: maxLife,
        maxLife,
      });
    }
  }

  public advance(): void {
    this.frame++;
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.vx *= 0.97;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  public isComplete(): boolean {
    return this.frame >= this.maxFrames || this.particles.length === 0;
  }

  private getParticleColor(p: Particle): string {
    const lifeRatio = Math.max(0, p.life / p.maxLife);
    const idx = Math.floor((1 - lifeRatio) * (FIRE_COLORS.length - 1));
    return FIRE_COLORS[Math.min(idx, FIRE_COLORS.length - 1)]!;
  }

  public render(): ReturnType<typeof Box> {
    const children: ReturnType<typeof Box>[] = [];

    let bgColor: string;
    if (this.frame === 0) {
      bgColor = "#FFCC00";
    } else if (this.frame === 1) {
      bgColor = "#AA4400";
    } else if (this.frame <= 3) {
      bgColor = "#441100";
    } else {
      bgColor = "#0A0000";
    }

    for (const p of this.particles) {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
        continue;
      }
      children.push(
        Box({ position: "absolute" as const, top: y, left: x }, Text({ content: p.char, fg: this.getParticleColor(p) })),
      );
    }

    return Box(
      {
        id: "explosion-overlay",
        position: "absolute" as const,
        zIndex: 99,
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: bgColor,
      },
      ...children,
    );
  }
}
