/**
 * Factory to create a LoadingScene class without importing Phaser at module
 * scope (avoids SSR issues). The returned scene shows the splash background
 * and tracks the main GameScene loader progress.
 */
export function createLoadingScene(Phaser: any) {
  return class LoadingScene extends Phaser.Scene {
    private progressText?: any;
    private subText?: any;
    private assetsComplete = false;
    private roomJoined = false;

    constructor() {
      super({ key: 'LoadingScene' });
    }

    preload(): void {
      if (!this.textures.exists('splash')) {
        this.load.image('splash', '/images/splash.png');
      }
    }

    create(): void {
      const { width, height } = this.scale;

      const bg = this.add.image(width / 2, height / 2, 'splash');
      bg.setOrigin(0.5, 0.5);
      const scaleX = width / bg.width;
      const scaleY = height / bg.height;
      bg.setScale(Math.max(scaleX, scaleY));

      this.progressText = this.add
        .text(width / 2, height - 40, 'Loading 0%', {
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: '14px',
          color: '#ffffff',
          letterSpacing: 3.5,
        })
        .setOrigin(0.5, 0.5);

      this.subText = this.add
        .text(width / 2, height - 18, 'Preparing assets…', {
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: '12px',
          color: '#dddddd',
          letterSpacing: 3.5,
        })
        .setOrigin(0.5, 0.5);

      // Start transparent to crossfade with React overlay text
      bg.setAlpha(0);
      this.progressText.setAlpha(0);
      this.subText.setAlpha(0);

      // Crossfade from React overlay to Phaser text to avoid text-jump
      try {
        const msg = document.getElementById('react-splash-text');
        if (msg) msg.textContent = 'Loading assets…';
        // After one frame, fade in Phaser elements while fading out overlay
        this.time.delayedCall(16, () => {
          // Fade in Phaser elements; overlay fades out separately
          this.tweens.add({
            targets: [bg, this.progressText, this.subText],
            alpha: 1,
            duration: 320,
            ease: 'Cubic.easeOut',
          });
          const reactOverlay = document.getElementById(
            'react-splash-overlay'
          ) as HTMLElement | null;
          if (reactOverlay) {
            reactOverlay.style.opacity = '0';
            const scrim = document.getElementById(
              'react-splash-scrim'
            ) as HTMLElement | null;
            if (scrim) scrim.style.opacity = '0.15';
            window.setTimeout(() => {
              reactOverlay.parentElement?.removeChild(reactOverlay);
            }, 200);
          }
          const phaserOverlay = document.getElementById(
            'phaser-splash-overlay'
          ) as HTMLElement | null;
          if (phaserOverlay) {
            phaserOverlay.style.opacity = '0';
            window.setTimeout(() => {
              phaserOverlay.parentElement?.removeChild(phaserOverlay);
            }, 200);
          }
        });
      } catch {}

      // Start the main game scene; ensure LoadingScene stays on top
      this.scene.launch('GameScene');
      // Crossfade: delay a tick to ensure GameScene is rendering before fade
      this.time.delayedCall(16, () => {
        this.scene.bringToTop('LoadingScene');
      });

      // Hook into the loader of the GameScene to mirror progress
      const main = this.scene.get('GameScene') as any;
      if (main && main.load) {
        const onProgress = (v: number) => {
          // Skip updates if scene is already shutting down
          if (!this.scene.isActive('LoadingScene')) return;
          this.progressText?.setText(`Loading ${Math.round(v * 100)}%`);
        };
        main.load.on('progress', onProgress);

        const onComplete = () => {
          this.progressText?.setText('Loading 100%');
          this.assetsComplete = true;
          main.load.off('progress', onProgress);
          this.maybeFinish();
        };
        main.load.once('complete', onComplete);

        // Safety: remove listener if this scene is shut down early
        this.events.once('shutdown', () => {
          main.load.off('progress', onProgress);
        });
      }

      // Also wait for a room-joined signal from the main scene
      const onRoomJoined = () => {
        this.roomJoined = true;
        this.maybeFinish();
      };
      // Handle both event and sticky registry flag if it was set earlier
      this.game.events.on('loading:room-joined', onRoomJoined);
      if (this.game?.registry?.get('roomJoined')) {
        onRoomJoined();
      }
      this.events.once('shutdown', () => {
        this.game.events.off('loading:room-joined', onRoomJoined);
      });

      this.scale.on('resize', (gameSize: any) => {
        const w = gameSize.width;
        const h = gameSize.height;
        bg.setPosition(w / 2, h / 2);
        const sX = w / bg.width;
        const sY = h / bg.height;
        bg.setScale(Math.max(sX, sY));
        this.progressText?.setPosition(w / 2, h - 40);
        this.subText?.setPosition(w / 2, h - 18);
      });
    }

    private maybeFinish(): void {
      if (!this.assetsComplete || !this.roomJoined) return;
      // Fade out splash and texts, then stop the scene
      const targets: any[] = [];
      // Collect all children for a simple fade
      (this.children?.list || []).forEach((child: any) => {
        if (typeof child.alpha === 'number') targets.push(child);
      });
      // Also mirror the text onto DOM overlay if still present to avoid flicker
      try {
        const el = document.getElementById('react-splash-overlay');
        if (el) {
          (el as HTMLElement).style.opacity = '1';
          targets.push({
            get alpha() {
              return Number((el as HTMLElement).style.opacity || '1');
            },
            set alpha(v: number) {
              (el as HTMLElement).style.opacity = String(v);
            },
          } as any);
        }
      } catch {}
      this.tweens.add({
        targets,
        alpha: 0,
        duration: 300,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          if (!this.scene.isActive('LoadingScene')) return;
          this.scene.stop('LoadingScene');
          this.scene.bringToTop('GameScene');
        },
      });
    }
  };
}
