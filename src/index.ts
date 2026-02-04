import '@playcanvas/web-components';
import {
    Asset,
    Entity,
    EnvLighting,
    EventHandler,
    MiniStats,
    Quat,
    SKYTYPE_BOX,
    SKYTYPE_DOME,
    Vec3,
    type Texture,
    type AppBase,
    revision as engineRevision,
    version as engineVersion
} from 'playcanvas';

import { observe } from './core/observe';
import { importSettings } from './settings';
import type { Config, Global } from './types';
import { initPoster, initUI } from './ui';
import { Viewer } from './viewer';
import { initXr } from './xr';
import { version as appVersion } from '../package.json';

const loadGsplat = async (app: AppBase, config: Config, progressCallback: (progress: number) => void) => {
    const { contents, contentUrl, unified, aa } = config;
    const c = contents as unknown as ArrayBuffer;
    const filename = new URL(contentUrl, location.href).pathname.split('/').pop();
    const data = filename.toLowerCase() === 'meta.json' ? await (await contents).json() : undefined;
    const asset = new Asset(filename, 'gsplat', { url: contentUrl, filename, contents: c }, data);

    return new Promise<Entity>((resolve, reject) => {
        asset.on('load', () => {
            const entity = new Entity('gsplat');
            entity.setLocalEulerAngles(0, 0, 180);
            entity.addComponent('gsplat', {
                unified: unified || filename.toLowerCase().endsWith('lod-meta.json'),
                asset
            });
            const material = entity.gsplat.unified ? app.scene.gsplat.material : entity.gsplat.material;
            material.setDefine('GSPLAT_AA', aa);
            material.setParameter('alphaClip', 1 / 255);
            app.root.addChild(entity);
            resolve(entity);
        });

        let watermark = 0;
        asset.on('progress', (received, length) => {
            const progress = Math.min(1, received / length) * 100;
            if (progress > watermark) {
                watermark = progress;
                progressCallback(Math.trunc(watermark));
            }
        });

        asset.on('error', (err) => {
            console.log(err);
            reject(err);
        });

        app.assets.add(asset);
        app.assets.load(asset);
    });
};

const loadSkybox = (app: AppBase, url: string) => {
    return new Promise<Asset>((resolve, reject) => {
        const asset = new Asset('skybox', 'texture', {
            url
        }, {
            type: 'rgbp',
            mipmaps: false,
            addressu: 'repeat',
            addressv: 'clamp'
        });

        asset.on('load', () => {
            resolve(asset);
        });

        asset.on('error', (err) => {
            console.log(err);
            reject(err);
        });

        app.assets.add(asset);
        app.assets.load(asset);
    });
};

const main = (app: AppBase, camera: Entity, settingsJson: any, config: Config) => {
    const events = new EventHandler();

    const state = observe(events, {
        readyToRender: false,
        hqMode: true,
        progress: 0,
        inputMode: 'desktop',
        cameraMode: 'orbit',
        hasAnimation: false,
        animationDuration: 0,
        animationTime: 0,
        animationPaused: true,
        hasAR: false,
        hasVR: false,
        isFullscreen: false,
        controlsHidden: false
    });

    const settings = importSettings(settingsJson);

    const global: Global = {
        app,
        settings,
        config,
        state,
        events,
        camera
    };

    // Initialize the load-time poster
    if (config.poster) {
        initPoster(events);
    }

    camera.addComponent('camera');

    // Initialize XR support
    initXr(global);

    // Initialize user interface
    initUI(global);

    // Load model
    const gsplatLoad = loadGsplat(
        app,
        config,
        (progress: number) => {
            state.progress = progress;
        }
    );

    // Resolve skybox URL: URL params take precedence over settings
    const skyboxUrl = config.skyboxUrl || settings.background.skyboxUrl;
    const skyboxProjection = config.skyboxProjection || settings.background.skyboxProjection || 'box';
    const skyboxScale = config.skyboxScale ?? settings.background.skyboxScale ?? 200;
    const skyboxCenter = config.skyboxCenter || settings.background.skyboxCenter || [0, 0, 0];

    // Load skybox
    const skyboxLoad = skyboxUrl &&
        loadSkybox(app, skyboxUrl).then((asset) => {
            const texture = asset.resource as Texture;

            // Convert equirectangular texture to cubemap for skybox rendering
            const skyboxCubemap = EnvLighting.generateSkyboxCubemap(texture);
            app.scene.skybox = skyboxCubemap;

            // Generate proper environment lighting
            const lighting = EnvLighting.generateLightingSource(texture);
            const envAtlas = EnvLighting.generateAtlas(lighting);
            lighting.destroy();
            app.scene.envAtlas = envAtlas;

            // Configure skybox projection type
            app.scene.sky.type = skyboxProjection === 'dome' ? SKYTYPE_DOME : SKYTYPE_BOX;

            // Configure skybox scale
            app.scene.sky.node.setLocalScale(new Vec3(skyboxScale, skyboxScale, skyboxScale));

            // Configure skybox center offset
            app.scene.sky.center = new Vec3(skyboxCenter[0], skyboxCenter[1], skyboxCenter[2]);

            // Enable depth write for depth-of-field effects
            app.scene.sky.depthWrite = true;
        });

    // Load and play sound
    if (global.settings.soundUrl) {
        const sound = new Audio(global.settings.soundUrl);
        sound.crossOrigin = 'anonymous';
        document.body.addEventListener('click', () => {
            if (sound) {
                sound.play();
            }
        }, {
            capture: true,
            once: true
        });
    }

    // Create the viewer
    return new Viewer(global, gsplatLoad, skyboxLoad);
};

console.log(`SuperSplat Viewer v${appVersion} | Engine v${engineVersion} (${engineRevision})`);

export { main };
