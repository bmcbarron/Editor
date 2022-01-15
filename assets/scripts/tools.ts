/**
 * Generated by the Babylon.JS Editor v${editor-version}
 */

import { Node } from "@babylonjs/core/node";
import { Scene } from "@babylonjs/core/scene";
import { Nullable } from "@babylonjs/core/types";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader"; 
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { SerializationHelper } from "@babylonjs/core/Misc/decorators";
import { Vector2, Vector3, Vector4, Matrix } from "@babylonjs/core/Maths/math.vector";

import { MotionBlurPostProcess } from "@babylonjs/core/PostProcesses/motionBlurPostProcess";
import { ScreenSpaceReflectionPostProcess } from "@babylonjs/core/PostProcesses/screenSpaceReflectionPostProcess";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";

import "@babylonjs/core/Audio/audioSceneComponent";
import "@babylonjs/core/Physics/physicsEngineComponent";
import "@babylonjs/core/Engines/Extensions/engine.textureSelector";
import "@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader";

export type NodeScriptConstructor = (new (...args: any[]) => Node);
export type GraphScriptConstructor = (new (scene: Scene) => any);
export type ScriptMap = {
    [index: string]: {
        IsGraph?: boolean;
        IsGraphAttached?: boolean;
        default: (new (...args: any[]) => NodeScriptConstructor | GraphScriptConstructor);
    }
};

export interface IScript {
    /**
     * Called on the node is being initialized.
     * This function is called immediatly after the constructor has been called.
     */
    onInitialize?(): void;
    /**
     * Called on the scene starts.
     */
    onStart?(): void;
    /**
     * Called each frame.
     */
    onUpdate?(): void;
    /**
     * Called on a message has been received and sent from a graph.
     * @param message defines the name of the message sent from the graph.
     * @param data defines the data sent in the message.
     * @param sender defines the reference to the graph class that sent the message.
     */
    onMessage?(name: string, data: any, sender: any): void;
}

export const projectConfiguration = "${project-configuration}";

/**
 * Configures the given engine according to the current project configuration (compressed textures, etc.).
 * @param engine defines the reference to the engine to configure.
 */
export function configureEngine(engine: Engine): void {
    if (projectConfiguration.compressedTextures.supportedFormats.length) {
        engine.setTextureFormatToUse(projectConfiguration.compressedTextures.supportedFormats);
    }
}

/**
 * Loads the given scene file and appends it to the given scene reference (`toScene`).
 * @param toScene defines the instance of `Scene` to append to.
 * @param rootUrl defines the root url for the scene and resources or the concatenation of rootURL and filename (e.g. http://example.com/test.glb)
 * @param sceneFilename defines the name of the scene file.
 */
export async function appendScene(toScene: Scene, rootUrl: string, sceneFilename: string): Promise<void> {
    await SceneLoader.AppendAsync(rootUrl, sceneFilename, toScene, null, ".babylon");

    return new Promise<void>((resolve) => {
        toScene.executeWhenReady(() => {
            runScene(toScene, rootUrl);
            resolve();
        });
    });
}

/**
 * Returns wether or not the given constructor is an ES6 (or more) class.
 * @param ctor defines the reference to the constructor to test.
 * @param scene defines the reference the scene in case the tested script is a graph.
 * @returns wether or not the given constructor is 
 */
function isEs6Class(ctor: any, scene: Scene): boolean {
    try {
        ctor.call({}, scene, {});
        return false;
    } catch (e) {
        return true;
    }
}

/**
 * Requires the nedded scripts for the given nodes array and attach them.
 * @param scene defines the reference to the scene that contains the given nodes.
 * @param scriptsMap defines the map that contains the scripts constructors ordered by script path.
 * @param nodes the array of nodes to attach script (if exists).
 */
function requireScriptForNodes(scene: Scene, scriptsMap: ScriptMap, nodes: (Node | Scene)[]): void {
    const dummyScene = new Scene(scene.getEngine(), { virtual: true });
    const initializedNodes: { node: Node | Scene; exports: any; }[] = [];

    // Initialize nodes
    for (const n of nodes as ((Scene | Node) & IScript)[]) {
        if (!n.metadata || !n.metadata.script || !n.metadata.script.name || n.metadata.script.name === "None") { continue; }

        const exports = scriptsMap[n.metadata.script.name];
        if (!exports) { continue; }

        const scene = n instanceof Scene ? n : n.getScene();

        // Get prototype.
        let prototype = exports.default.prototype;

        // Call constructor
        if (isEs6Class(prototype.constructor, scene)) {
            const currentScene = EngineStore.LastCreatedScene;
            EngineStore._LastCreatedScene = dummyScene;

            const clone = exports.IsGraph ?
                Reflect.construct(prototype.constructor.bind(n), [scene, n]) :
                Reflect.construct(prototype.constructor.bind(n), []);
            Reflect.setPrototypeOf(n, clone.constructor.prototype);

            EngineStore._LastCreatedScene = currentScene;

            for (const key in clone) {
                if (!Reflect.has(n, key)) {
                    n[key] = clone[key];
                }
            }

            clone.dispose();
        } else {
            if (exports.IsGraph) {
                exports.IsGraphAttached = true;
                prototype.constructor.call(n, scene, n);
            } else {
                prototype.constructor.call(n);
            }

            // Add prototype
            do {
                for (const key in prototype) {
                    if (!prototype.hasOwnProperty(key) || key === "constructor") { continue; }
                    n[key] = prototype[key].bind(n);
                }

                prototype = Object.getPrototypeOf(prototype);
            } while (prototype.constructor?.IsComponent === true);
        }

        // Call onInitialize
        n.onInitialize?.call(n);

        initializedNodes.push({ node: n, exports });
    }

    // Configure initialized nodes
    for (const i of initializedNodes) {
        const n = i.node as (Scene | Node) & IScript;
        const e = i.exports;
        const scene = i.node instanceof Scene ? i.node : i.node.getScene();

        // Check start
        if (n.onStart) {
            let startObserver = scene.onBeforeRenderObservable.addOnce(() => {
                startObserver = null!;
                n.onStart();
            });

            n.onDisposeObservable.addOnce(() => {
                if (startObserver) {
                    scene.onBeforeRenderObservable.remove(startObserver);
                }
            });
        }

        // Check update
        if (n.onUpdate) {
            const updateObserver = scene.onBeforeRenderObservable.add(() => n.onUpdate());
            n.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(updateObserver));
        }

        // Check properties
        const properties = n.metadata.script.properties ?? {};
        for (const key in properties) {
            const p = properties[key];

            switch (p.type) {
                case "Vector2": n[key] = new Vector2(p.value.x, p.value.y); break;
                case "Vector3": n[key] = new Vector3(p.value.x, p.value.y, p.value.z); break;
                case "Vector4": n[key] = new Vector4(p.value.x, p.value.y, p.value.z, p.value.w); break;

                case "Color3": n[key] = new Color3(p.value.r, p.value.g, p.value.b); break;
                case "Color4": n[key] = new Color4(p.value.r, p.value.g, p.value.b, p.value.a); break;

                default: n[key] = p.value; break;
            }
        }

        // Check linked children.
        if (n instanceof Node) {
            const childrenLinks = (e.default as any)._ChildrenValues ?? [];
            for (const link of childrenLinks) {
                const child = n.getChildren((node => node.name === link.nodeName), true)[0];
                n[link.propertyKey] = child;
            }
        }

        // Check linked nodes from scene.
        const sceneLinks = (e.default as any)._SceneValues ?? [];
        for (const link of sceneLinks) {
            const node = scene.getNodeByName(link.nodeName);
            n[link.propertyKey] = node;
        }

        // Check particle systems
        const particleSystemLinks = (e.default as any)._ParticleSystemValues ?? [];
        for (const link of particleSystemLinks) {
            const ps = scene.particleSystems.filter((ps) => ps.emitter === n && ps.name === link.particleSystemName)[0];
            n[link.propertyKey] = ps;
        }

        // Check animation groups
        const animationGroupLinks = (e.default as any)._AnimationGroupValues ?? [];
        for (const link of animationGroupLinks) {
            const ag = scene.getAnimationGroupByName(link.animationGroupName);
            n[link.propertyKey] = ag;
        }

        // Sounds
        const soundLinks = (e.default as any)._SoundValues ?? [];
        for (const link of soundLinks) {
            switch (link.type) {
                case "global": n[link.propertyKey] = scene.mainSoundTrack.soundCollection.find((s) => s.name === link.soundName && !s.spatialSound); break;
                case "spatial": n[link.propertyKey] = scene.mainSoundTrack.soundCollection.find((s) => s.name === link.soundName && s.spatialSound); break;
                default: n[link.propertyKey] = scene.getSoundByName(link.soundName); break;
            }
        }

        // Check pointer events
        const pointerEvents = (e.default as any)._PointerValues ?? [];
        for (const event of pointerEvents) {
            scene.onPointerObservable.add((e) => {
                if (e.type !== event.type) { return; }
                if (!event.onlyWhenMeshPicked) { return n[event.propertyKey](e); }

                if (e.pickInfo?.pickedMesh === n) {
                    n[event.propertyKey](e);
                }
            });
        }

        // Check keyboard events
        const keyboardEvents = (e.default as any)._KeyboardValues ?? [];
        for (const event of keyboardEvents) {
            scene.onKeyboardObservable.add((e) => {
                if (event.type && e.type !== event.type) { return; }

                if (!event.keys.length) { return n[event.propertyKey](e); }

                if (event.keys.indexOf(e.event.keyCode) !== -1 || event.keys.indexOf(e.event.key) !== -1) {
                    n[event.propertyKey](e);
                }
            });
        }

        // Retrieve impostors
        if (n instanceof AbstractMesh && !n.physicsImpostor) {
            n.physicsImpostor = n._scene.getPhysicsEngine()?.getImpostorForPhysicsObject(n);
        }

        delete n.metadata.script;
    }

    dummyScene.dispose();
}

/**
 * Works as an helper, this will:
 * = attach scripts on objects.
 * @param scene the scene to attach scripts, etc.
 */
export async function runScene(scene: Scene, rootUrl?: string): Promise<void> {
    const scriptsMap = require("./scripts-map").scriptsMap;

    // Attach scripts to objects in scene.
    attachScripts(scriptsMap, scene);

    // Configure post-processes
    configurePostProcesses(scene, rootUrl);

    // Rendering groups
    setupRenderingGroups(scene);

    // Pose matrices
    applyMeshesPoseMatrices(scene);

    // Apply colliders
    applyMeshColliders(scene);
}

/**
 * Attaches all available scripts on nodes of the given scene.
 * @param scene the scene reference that contains the nodes to attach scripts.
 */
export function attachScripts(scriptsMap: ScriptMap, scene: Scene): void {
    requireScriptForNodes(scene, scriptsMap, scene.meshes);
    requireScriptForNodes(scene, scriptsMap, scene.lights);
    requireScriptForNodes(scene, scriptsMap, scene.cameras);
    requireScriptForNodes(scene, scriptsMap, scene.transformNodes);
    requireScriptForNodes(scene, scriptsMap, [scene]);

    // Graphs
    for (const scriptKey in scriptsMap) {
        const script = scriptsMap[scriptKey];
        if (script.IsGraph && !script.IsGraphAttached) {
            const instance = new script.default(scene);
            scene.executeWhenReady(() => instance["onStart"]());
            scene.onBeforeRenderObservable.add(() => instance["onUpdate"]());
        }
    }
}

/**
 * Applies the waiting mesh colliders in case the scene is incremental.
 * @param scene defines the reference to the scene that contains the mesh colliders to apply.
 */
export function applyMeshColliders(scene: Scene): void {
    scene.meshes.forEach((m) => {
        if (m instanceof Mesh && m.metadata?.collider) {
            m._checkDelayState();
        }
    });
}

/**
 * Setups the rendering groups for meshes in the given scene.
 * @param scene defines the scene containing the meshes to configure their rendering group Ids.
 */
export function setupRenderingGroups(scene: Scene): void {
    scene.meshes.forEach((m) => {
        if (!m.metadata || !(m instanceof Mesh)) { return; }
        m.renderingGroupId = m.metadata.renderingGroupId ?? m.renderingGroupId;
    });
}

/**
 * Meshes using pose matrices with skeletons can't be parsed directly as the pose matrix is
 * missing from the serialzied data of meshes. These matrices are stored in the meshes metadata
 * instead and can be applied by calling this function.
 * @param scene defines the scene containing the meshes to configure their pose matrix.
 */
export function applyMeshesPoseMatrices(scene: Scene): void {
    scene.meshes.forEach((m) => {
        if (m.skeleton && m.metadata?.basePoseMatrix) {
            m.updatePoseMatrix(Matrix.FromArray(m.metadata.basePoseMatrix));
            delete m.metadata.basePoseMatrix;
        }
    })
}

/**
 * Attaches the a script at runtime to the given node according to the given script's path.
 * @param scriptPath defines the path to the script to attach (available as a key in the exported "scriptsMap" map).
 * @param object defines the reference to the object (node or scene) to attach the script to.
 */
export function attachScriptToNodeAtRuntime(scriptPath: string, object: Node | Scene): any {
    const scriptsMap = require("./scripts-map").scriptsMap;

    object.metadata = object.metadata ?? {};
    object.metadata.script = object.metadata.script ?? {};
    object.metadata.script.name = scriptPath;

    requireScriptForNodes(object instanceof Scene ? object : object.getScene(), scriptsMap, [object]);
}

/**
 * Defines the reference to the SSAO2 rendering pipeline.
 */
export let ssao2RenderingPipelineRef: Nullable<SSAO2RenderingPipeline> = null;
/**
 * Defines the reference to the SSR post-process.
 */
export let screenSpaceReflectionPostProcessRef: Nullable<ScreenSpaceReflectionPostProcess> = null;
/**
 * Defines the reference to the default rendering pipeline.
 */
export let defaultRenderingPipelineRef: Nullable<DefaultRenderingPipeline> = null;
/**
 * Defines the reference to the motion blur post-process.
 */
export let motionBlurPostProcessRef: Nullable<MotionBlurPostProcess> = null;

/**
 * Configures and attaches the post-processes of the given scene.
 * @param scene the scene where to create the post-processes and attach to its cameras.
 * @param rootUrl the root Url where to find extra assets used by pipelines. Should be the same as the scene.
 */
export function configurePostProcesses(scene: Scene, rootUrl: string = null): void {
    if (rootUrl === null || !scene.metadata?.postProcesses) { return; }

    // Load  post-processes configuration
    const data = scene.metadata.postProcesses;

    if (data.ssao && !ssao2RenderingPipelineRef) {
        ssao2RenderingPipelineRef = SSAO2RenderingPipeline.Parse(data.ssao.json, scene, rootUrl);
        if (data.ssao.enabled) {
            scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(ssao2RenderingPipelineRef.name, scene.cameras);
        }
    }

    if (data.screenSpaceReflections?.json && !screenSpaceReflectionPostProcessRef) {
        screenSpaceReflectionPostProcessRef = ScreenSpaceReflectionPostProcess._Parse(data.screenSpaceReflections.json, scene.activeCamera!, scene, "");
    }

    if (data.default && !defaultRenderingPipelineRef) {
        defaultRenderingPipelineRef = DefaultRenderingPipeline.Parse(data.default.json, scene, rootUrl);
        if (!data.default.enabled) {
            scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(defaultRenderingPipelineRef.name, scene.cameras);
        }
    }

    if (data.motionBlur?.json) {
        motionBlurPostProcessRef = MotionBlurPostProcess._Parse(data.motionBlur.json, scene.activeCamera!, scene, "");
    }

    scene.onDisposeObservable.addOnce(() => {
        ssao2RenderingPipelineRef = null;
        screenSpaceReflectionPostProcessRef = null;
        defaultRenderingPipelineRef = null;
        motionBlurPostProcessRef = null;
    });
}

/**
 * Overrides the texture parser.
 */
(function overrideTextureParser(): void {
    const textureParser = SerializationHelper._TextureParser;
    SerializationHelper._TextureParser = (sourceProperty, scene, rootUrl) => {
        if (sourceProperty.isCube && !sourceProperty.isRenderTarget && sourceProperty.files && sourceProperty.metadata?.isPureCube) {
            sourceProperty.files.forEach((f, index) => {
                sourceProperty.files[index] = rootUrl + f;
            });
        }

        const texture = textureParser.call(SerializationHelper, sourceProperty, scene, rootUrl);

        if (sourceProperty.url) {
            texture.url = rootUrl + sourceProperty.url;
        }

        return texture;
    };
})();

/**
 * @deprecated will be moved to "./decorators.ts".
 */
export * from "./decorators";
