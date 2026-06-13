function isMobileDeferredAvatarModel() {
  return Boolean(window.isViewerMobileFastLoad?.() && CONFIG?.mobile?.deferAvatarModelOnMobile !== false);
}

function scheduleDeferredAvatarModelLoad(root) {
  if (!root || root.userData?.externalModelLoadScheduled) return;
  root.userData.externalModelLoadScheduled = true;
  const delay = Math.max(0, Number(CONFIG.mobile?.avatarModelDeferredLoadMs || 10000));
  window.__MobilePerfProbe?.markOnce?.('avatar-scheduled', {
    delayMs: delay,
    resource: String(CONFIG.avatarModelUrl || '').split('/').pop() || 'visitor.glb',
    resourceStatus: 'scheduled'
  });

  const startLoadWhenSafe = () => {
    if (!root || root.userData?.externalModel || root.userData?.externalModelLoading) return;
    if (typeof isSitting !== 'undefined' && isSitting) {
      window.setTimeout(startLoadWhenSafe, 2500);
      return;
    }
    root.userData.externalModelLoading = true;
    loadExternalAvatarModel(root);
  };

  const scheduleAfterRoom = () => window.setTimeout(startLoadWhenSafe, delay);
  if (typeof roomLoaded !== 'undefined' && roomLoaded) scheduleAfterRoom();
  else window.addEventListener('viewer:room-ready', scheduleAfterRoom, { once: true });
}

function createVisitorAvatar() {
  const root = new THREE.Group();
  root.name = 'VISITOR_AVATAR';

  const fallbackGroup = new THREE.Group();
  fallbackGroup.name = 'FALLBACK_SIMPLE_AVATAR';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x1d2430,
    roughness: 0.72,
    metalness: 0.05
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xe8c06d,
    roughness: 0.52,
    metalness: 0.12
  });

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd7b38c,
    roughness: 0.75,
    metalness: 0.0
  });

  const legGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.78, 12);
  const legL = new THREE.Mesh(legGeo, bodyMat);
  legL.position.set(-0.075, 0.39, 0);
  const legR = new THREE.Mesh(legGeo, bodyMat);
  legR.position.set(0.075, 0.39, 0);

  const torsoGeo = new THREE.CapsuleGeometry(0.18, 0.62, 8, 16);
  const torso = new THREE.Mesh(torsoGeo, bodyMat);
  torso.position.set(0, 1.05, 0);

  const headGeo = new THREE.SphereGeometry(0.155, 24, 16);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.set(0, 1.55, 0);

  const chestGeo = new THREE.BoxGeometry(0.42, 0.08, 0.08);
  const chest = new THREE.Mesh(chestGeo, accentMat);
  chest.position.set(0, 1.25, 0.15);

  const noseGeo = new THREE.ConeGeometry(0.045, 0.12, 16);
  const nose = new THREE.Mesh(noseGeo, accentMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.52, 0.17);

  const shadowGeo = new THREE.CircleGeometry(0.34, 32);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.24,
    depthWrite: false
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;

  fallbackGroup.add(shadow, legL, legR, torso, chest, head, nose);
  root.add(fallbackGroup);

  root.userData.parts = {
    legL,
    legR,
    torso,
    chest,
    head,
    nose,
    shadow
  };
  root.userData.fallbackGroup = fallbackGroup;
  root.userData.externalModel = null;
  root.userData.modelPivot = null;

  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });

  avatar = root;
  scene.add(avatar);

  avatar.position.set(camera.position.x, camera.position.y - CONFIG.eyeHeight, camera.position.z);
  avatar.rotation.y = yaw;
  avatar.visible = CONFIG.avatarEnabled && viewMode === 'third';

  if (typeof snapAvatarRootToGround === 'function') {
    snapAvatarRootToGround(root, 'createVisitorAvatar');
  }

  if (isMobileDeferredAvatarModel()) {
    avatarModelLoaded = false;
    root.userData.externalModelDeferred = true;
    scheduleDeferredAvatarModelLoad(root);
  } else {
    root.userData.externalModelLoading = true;
    loadExternalAvatarModel(root);
  }

  return avatar;
}

function isValidBox(box) {
  return (
    box &&
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z) &&
    box.max.x >= box.min.x &&
    box.max.y >= box.min.y &&
    box.max.z >= box.min.z
  );
}

function computeAvatarModelBox(model) {
  // Box3.setFromObject đôi khi không ổn với Armature/SkinnedMesh export từ Blender.
  // Hàm này chỉ lấy Mesh/SkinnedMesh thật, bỏ qua xương/empty/animation data.
  model.updateWorldMatrix(true, true);

  const box = new THREE.Box3();
  let hasMeshBox = false;

  model.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (!obj.geometry) return;

    if (!obj.geometry.boundingBox) {
      obj.geometry.computeBoundingBox();
    }

    if (!obj.geometry.boundingBox) return;

    const meshBox = obj.geometry.boundingBox.clone();
    meshBox.applyMatrix4(obj.matrixWorld);

    if (isValidBox(meshBox)) {
      box.union(meshBox);
      hasMeshBox = true;
    }
  });

  if (hasMeshBox && isValidBox(box)) return box;

  // Fallback cuối cùng.
  const fallbackBox = new THREE.Box3().setFromObject(model);
  if (isValidBox(fallbackBox)) return fallbackBox;

  return null;
}

function normalizeAvatarModel(model) {
  model.visible = true;

  model.traverse((obj) => {
    obj.visible = true;
  });

  model.updateWorldMatrix(true, true);

  let box = computeAvatarModelBox(model);
  if (!box) {
    console.warn('Avatar GLB không có bounding box hợp lệ.');
    return false;
  }

  let size = box.getSize(new THREE.Vector3());
  let height = size.y;

  if (!Number.isFinite(height) || height <= 0.001) {
    console.warn('Avatar GLB height không hợp lệ:', height, box);
    return false;
  }

  // Nếu model export từ Blender có transform lạ, scale về chiều cao chuẩn.
  const scale = CONFIG.avatarModelHeight / height;
  model.scale.multiplyScalar(scale);

  model.updateWorldMatrix(true, true);

  box = computeAvatarModelBox(model);
  if (!box) return false;

  const center = box.getCenter(new THREE.Vector3());

  // Đưa chân avatar về y = 0 và tâm X/Z về gốc group.
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  model.updateWorldMatrix(true, true);

  box = computeAvatarModelBox(model);
  const finalSize = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3();

  console.log('[Avatar GLB] normalized', {
    scale,
    heightBefore: height,
    heightAfter: finalSize.y,
    box,
  });

  return true;
}


function prepareDirectAvatarModel(model) {
  // V24: đường đi an toàn nhất cho GLB export từ Blender.
  // Không ép normalize bằng bounding box nếu không cần, vì SkinnedMesh/Armature có thể cho box sai.
  model.visible = true;
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.setScalar(CONFIG.avatarModelManualScale);

  model.traverse((obj) => {
    obj.visible = true;
    obj.frustumCulled = false;
  });

  let meshCount = 0;
  model.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh) meshCount += 1;
  });

  if (meshCount <= 0) {
    console.warn('[Avatar GLB V24] Không tìm thấy mesh trong file avatar.');
    return { ok: false, reason: 'NO_MESH', meshCount };
  }

  let boxBefore = null;
  try { boxBefore = computeAvatarModelBox(model); } catch (err) { console.warn(err); }

  if (CONFIG.avatarAutoNormalize) {
    const normalizedOk = normalizeAvatarModel(model);
    return {
      ok: !!normalizedOk,
      reason: normalizedOk ? 'AUTO_NORMALIZED' : 'AUTO_NORMALIZE_FAILED',
      meshCount,
      boxBefore,
      boxAfter: normalizedOk ? computeAvatarModelBox(model) : null,
    };
  }

  // Không normalize: giữ đúng transform gốc từ Blender, chỉ đưa vào pivot của avatar.
  model.updateWorldMatrix(true, true);
  const boxAfter = computeAvatarModelBox(model);

  console.log('[Avatar GLB V24] direct mode', {
    meshCount,
    manualScale: CONFIG.avatarModelManualScale,
    autoNormalize: CONFIG.avatarAutoNormalize,
    boxBefore,
    boxAfter,
    note: 'Nếu avatar quá to/nhỏ, chỉnh avatarModelManualScale. Nếu lệch gốc, bật avatarAutoNormalize: true.'
  });

  return { ok: true, reason: 'DIRECT_BLENDER_MODE', meshCount, boxBefore, boxAfter };
}

function tuneAvatarMaterialRuntime(mat) {
  const tuning = CONFIG.avatarMaterialTuning || {};
  if (!tuning.enabled || !mat) return;

  const maxMetalness = Number.isFinite(tuning.maxMetalness) ? tuning.maxMetalness : 0.08;
  const minRoughness = Number.isFinite(tuning.minRoughness) ? tuning.minRoughness : 0.72;
  const maxEnvMapIntensity = Number.isFinite(tuning.maxEnvMapIntensity) ? tuning.maxEnvMapIntensity : 0.35;

  // Chỉ can thiệp các thuộc tính PBR có sẵn trên material avatar.
  // Không đổi texture, không đổi màu, không thay material type.
  if ('metalness' in mat) {
    const currentMetalness = Number.isFinite(mat.metalness) ? mat.metalness : 0;
    mat.metalness = Math.min(currentMetalness, maxMetalness);
  }

  if ('roughness' in mat) {
    const currentRoughness = Number.isFinite(mat.roughness) ? mat.roughness : 0.5;
    mat.roughness = Math.max(currentRoughness, minRoughness);
  }

  if ('envMapIntensity' in mat) {
    const currentEnvMapIntensity = Number.isFinite(mat.envMapIntensity) ? mat.envMapIntensity : 1;
    mat.envMapIntensity = Math.min(currentEnvMapIntensity, maxEnvMapIntensity);
  }

  mat.needsUpdate = true;
}


function loadExternalAvatarModel(root) {
  if (!CONFIG.useExternalAvatarModel || !CONFIG.avatarModelUrl || !root) {
    if (root?.userData) root.userData.externalModelLoading = false;
    window.__MobilePerfProbe?.markOnce?.('avatar-fallback-used', { reason: 'external-avatar-disabled-or-missing-url' });
    return;
  }

  window.__MobilePerfProbe?.markOnce?.('avatar-load-start', {
    resource: String(CONFIG.avatarModelUrl || '').split('/').pop() || 'visitor.glb',
    resourceStatus: 'loading'
  }, { snapshot: true });

  gltfLoader.load(
    CONFIG.avatarModelUrl,
    (gltf) => {
      root.userData.externalModelLoading = false;
      window.__MobilePerfProbe?.markOnce?.('avatar-load-ok', {
        resource: String(CONFIG.avatarModelUrl || '').split('/').pop() || 'visitor.glb',
        resourceStatus: 'loaded',
        animations: Array.isArray(gltf.animations) ? gltf.animations.length : 0
      }, { snapshot: true });
      window.__MobilePerfProbe?.markOnce?.('avatar-prepare-start', {
        animations: Array.isArray(gltf.animations) ? gltf.animations.length : 0
      });
      const model = gltf.scene;
      model.name = 'VISITOR_AVATAR_GLB_MODEL';

      model.traverse((obj) => {
        if (obj.isMesh || obj.isSkinnedMesh) {
          obj.frustumCulled = false;
          obj.castShadow = false;
          obj.receiveShadow = true;

          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((mat) => {
              mat.side = THREE.DoubleSide;

              // Tránh trường hợp material export alpha/transparent làm avatar gần như vô hình.
              if (mat.opacity !== undefined && mat.opacity < 0.05) mat.opacity = 1;
              if (mat.transparent && mat.opacity >= 0.98) mat.transparent = false;

              tuneAvatarMaterialRuntime(mat);
              mat.needsUpdate = true;
            });
          }
        }
      });

      const prepared = prepareDirectAvatarModel(model);

      const modelPivot = new THREE.Group();
      modelPivot.name = 'AVATAR_GLB_PIVOT';
      modelPivot.position.y = CONFIG.avatarModelYOffset;
      modelPivot.rotation.y = CONFIG.avatarModelYawOffset;
      modelPivot.add(model);

      window.__MobilePerfProbe?.markOnce?.('avatar-attach-start', {
        prepared: Boolean(prepared?.ok),
        meshCount: Number(prepared?.meshCount || 0)
      }, { snapshot: true });
      root.add(modelPivot);

      avatarModelLoaded = !!prepared.ok;
      root.userData.externalModel = avatarModelLoaded ? model : null;
      root.userData.modelPivot = avatarModelLoaded ? modelPivot : null;
      root.userData.avatarPrepareInfo = prepared;

      window.__avatarDebug = {
        root,
        model,
        modelPivot,
        prepared,
        config: CONFIG,
        showFallback() {
          if (root.userData.fallbackGroup) root.userData.fallbackGroup.visible = true;
        },
        hideFallback() {
          if (root.userData.fallbackGroup) root.userData.fallbackGroup.visible = false;
        },
        setScale(v = 1) {
          model.scale.setScalar(v);
          forceAvatarCameraView();
          console.log('[Avatar Debug] set scale', v, computeAvatarModelBox(model));
        },
        nudgeY(v = 0) {
          modelPivot.position.y = v;
          forceAvatarCameraView();
          console.log('[Avatar Debug] pivot y', v);
        },
        groundNow() {
          const result = typeof groundAvatarNow === 'function' ? groundAvatarNow('manual_debug') : null;
          forceAvatarCameraView();
          console.log('[Avatar Debug] ground now', result);
          return result;
        },
        footOffset() {
          const result = typeof calculateAvatarFootOffset === 'function' ? calculateAvatarFootOffset(root) : null;
          console.log('[Avatar Debug] foot offset', result);
          return result;
        }
      };

      if (avatarModelLoaded) {
        if (root.userData.fallbackGroup) {
          root.userData.fallbackGroup.visible = !!CONFIG.avatarDebugKeepFallback;
        }

        if (typeof applyAvatarGroundOffset === 'function') {
          applyAvatarGroundOffset(root, 'avatar_glb_loaded');
        }
        if (typeof snapAvatarRootToGround === 'function') {
          snapAvatarRootToGround(root, 'avatar_glb_loaded');
        }

        setupAvatarAnimations(model, gltf.animations || []);

        // QUAN TRỌNG: không sync avatar lại về vị trí camera sau khi GLB load.
        // Root avatar đã có vị trí đúng từ lúc createVisitorAvatar().
        // Sync lại ở đây từng làm avatar/camera trôi vị trí và khó quan sát.
        forceAvatarCameraView();

        console.log('[Avatar GLB V24] loaded OK', prepared);
        window.__MobilePerfProbe?.markOnce?.('avatar-attach-ok', {
          meshCount: Number(prepared?.meshCount || 0),
          reason: prepared?.reason || 'ok',
          resource: String(CONFIG.avatarModelUrl || '').split('/').pop() || 'visitor.glb',
          resourceStatus: 'attached'
        }, { snapshot: true });
        if (window.__MobilePerfProbe?.enabled) {
          window.setTimeout(() => {
            if (root?.userData?.externalModel && root?.userData?.modelPivot) {
              window.__MobilePerfProbe?.markOnce?.('avatar-stable', { afterAttachMs: 1200 }, { snapshot: true });
            }
          }, 1200);
        }
        setStatus(`✅ <strong>Sẵn sàng tham quan</strong>`);
      } else {
        console.warn('[Avatar GLB V24] load được nhưng không dùng được, giữ fallback.', {
          prepared,
          animations: gltf.animations?.map((c) => c.name),
        });

        if (root.userData.fallbackGroup) {
          root.userData.fallbackGroup.visible = true;
        }
        window.__MobilePerfProbe?.markOnce?.('avatar-fallback-used', {
          reason: prepared?.reason || 'avatar-prepare-failed'
        }, { snapshot: true });

        setStatus(`⚠️ <strong>Có lỗi</strong>`);
      }
    },
    undefined,
    (error) => {
      root.userData.externalModelLoading = false;
      console.warn('Không load được avatar GLB, dùng avatar đơn giản.', error);
      window.__MobilePerfProbe?.markOnce?.('avatar-fallback-used', {
        reason: error?.message || 'avatar-load-error',
        resource: String(CONFIG.avatarModelUrl || '').split('/').pop() || 'visitor.glb',
        resourceStatus: 'error'
      }, { snapshot: true });
      avatarModelLoaded = false;
      setStatus(`⚠️ <strong>Chưa load được avatar GLB</strong><br>Đang dùng avatar đơn giản.<br>Kiểm tra file: ${CONFIG.avatarModelUrl}<br>Mở Console để xem lỗi chi tiết.`);
    }
  );
}


function isRootMotionPositionTrack(trackName) {
  const n = String(trackName || '').toLowerCase();

  if (!n.endsWith('.position')) return false;

  // Các tên thường gặp khi export từ Blender / Mixamo / ReadyPlayerMe.
  // Chỉ khóa track position của root/hips/pelvis/armature, giữ rotation của xương tay/chân.
  return (
    n.includes('hips.position') ||
    n.includes('pelvis.position') ||
    n.includes('root.position') ||
    n.includes('armature.position') ||
    n.includes('mixamorig:hips.position') ||
    n.includes('visitor_avatar_armature.position') ||
    n.includes('armature|') ||
    n === '.position'
  );
}

function makeClipInPlace(clip) {
  if (!CONFIG.avatarStripRootMotion || !clip || !clip.tracks) return clip;

  let changed = false;

  const tracks = clip.tracks.map((track) => {
    const trackName = track.name || '';
    const isVectorTrack =
      track.ValueTypeName === 'vector' ||
      track.constructor?.name === 'VectorKeyframeTrack';

    if (!isVectorTrack || !isRootMotionPositionTrack(trackName)) {
      return track.clone();
    }

    const values = Array.from(track.values);
    const times = Array.from(track.times);

    if (values.length >= 3) {
      const baseX = values[0];
      const baseY = values[1];
      const baseZ = values[2];

      for (let i = 0; i < values.length; i += 3) {
        // Khóa cả XYZ của root để animation chỉ còn chuyển động tay/chân/thân.
        // Đây là bản "in-place" giống character controller chuyên nghiệp.
        values[i] = baseX;
        values[i + 1] = baseY;
        values[i + 2] = baseZ;
      }

      changed = true;
      return new THREE.VectorKeyframeTrack(trackName, times, values);
    }

    return track.clone();
  });

  if (!changed) return clip;

  const fixedClip = new THREE.AnimationClip(`${clip.name || 'clip'}_INPLACE`, clip.duration, tracks);
  fixedClip.optimize();

  console.log('[Avatar Animation] stripped root motion:', clip.name, '->', fixedClip.name);

  return fixedClip;
}

function makeActionForClip(model, clip, modeName) {
  let clipToUse = clip;

  if (modeName === 'walk' || modeName === 'run') {
    clipToUse = makeClipInPlace(clip);
  }

  const action = avatarMixer.clipAction(clipToUse);

  if (modeName === 'walk') action.timeScale = CONFIG.avatarWalkTimeScale;
  if (modeName === 'run') action.timeScale = CONFIG.avatarRunTimeScale;

  if (modeName === 'sitdown' || modeName === 'situp') {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  }

  action.userData = { ...(action.userData || {}), avatarActionName: modeName, sourceClipName: clip?.name || '' };
  return action;
}

function getAvatarDisabledActionSet() {
  const list = Array.isArray(CONFIG?.avatarDisabledActions) ? CONFIG.avatarDisabledActions : ['jump'];
  return new Set(list.map((name) => String(name || '').toLowerCase()).filter(Boolean));
}

function normalizeAvatarClipName(name = '') {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '');
}

function isAvatarClipDisabled(clipName, disabled = getAvatarDisabledActionSet()) {
  const n = normalizeAvatarClipName(clipName);
  if (!n) return false;
  if (disabled.has(n)) return true;
  // H_D_C: jump may remain in GLB, but runtime must not map/play it.
  return n.includes('jump');
}

function isSitTransitionClipName(name, type) {
  const raw = String(name || '').toLowerCase();
  const n = normalizeAvatarClipName(raw);
  if (type === 'sitdown') {
    return n === 'sitdown' || n.includes('sitdown') || raw.includes('sit down') || raw.includes('sit_down');
  }
  if (type === 'situp') {
    return n === 'situp' || n.includes('situp') || raw.includes('sit up') || raw.includes('sit_up') || n.includes('standup') || raw.includes('stand up') || raw.includes('get up');
  }
  return false;
}

function isPlainSitClipName(name) {
  const raw = String(name || '').toLowerCase();
  const n = normalizeAvatarClipName(raw);
  if (!n || isAvatarClipDisabled(n)) return false;
  if (isSitTransitionClipName(raw, 'sitdown') || isSitTransitionClipName(raw, 'situp')) return false;
  return n === 'sit' || n === 'sitting' || raw.includes('sitting') || raw.includes('chair');
}

function findAvatarClipForMode(clips, modeName, usedClips, disabled) {
  const exact = clips.find((clip) => {
    const n = normalizeAvatarClipName(clip?.name || '');
    return n === modeName && !usedClips.has(clip) && !isAvatarClipDisabled(n, disabled);
  });
  if (exact) return exact;

  return clips.find((clip) => {
    if (usedClips.has(clip)) return false;
    const raw = String(clip?.name || '').toLowerCase();
    const n = normalizeAvatarClipName(raw);
    if (!n || isAvatarClipDisabled(n, disabled)) return false;

    if (modeName === 'idle') return n.includes('idle') || n.includes('stand') || n.includes('breath');
    if (modeName === 'walk') return n.includes('walk') || n.includes('walking');
    if (modeName === 'run') return n.includes('run') || n.includes('running');
    if (modeName === 'sitdown') return isSitTransitionClipName(raw, 'sitdown');
    if (modeName === 'situp') return isSitTransitionClipName(raw, 'situp');
    if (modeName === 'sit') return isPlainSitClipName(raw);
    return false;
  });
}

function setupAvatarAnimations(model, clips) {
  avatarMixer = null;
  avatarActions = {};
  currentAvatarAction = null;
  currentAvatarActionName = null;
  avatarMotionState = 'idle';

  if (!clips || clips.length === 0) {
    console.log('[Avatar GLB] không có animation, dùng pose tĩnh.');
    return;
  }

  avatarMixer = new THREE.AnimationMixer(model);

  const disabled = getAvatarDisabledActionSet();
  const usedClips = new Set();
  const allowedModes = ['idle', 'walk', 'run', 'sitdown', 'sit', 'situp'];
  const skippedDisabled = [];

  clips.forEach((clip) => {
    const clipName = clip?.name || '';
    if (isAvatarClipDisabled(clipName, disabled)) skippedDisabled.push(clipName || '(unnamed)');
  });

  allowedModes.forEach((modeName) => {
    const clip = findAvatarClipForMode(clips, modeName, usedClips, disabled);
    if (!clip) return;
    avatarActions[modeName] = makeActionForClip(model, clip, modeName);
    usedClips.add(clip);
  });

  // Rất quan trọng với GLB export từ Blender:
  // Không tự lấy clip[0] tên "Action/ArmatureAction" làm idle,
  // vì clip này có thể chứa root motion làm avatar trôi khỏi vị trí.
  // H_D_C: fallback index chỉ áp dụng khi người vận hành tắt chế độ only-named.
  if (!CONFIG.avatarOnlyUseNamedAnimations) {
    if (!avatarActions.idle && clips[0] && !isAvatarClipDisabled(clips[0].name, disabled)) avatarActions.idle = makeActionForClip(model, clips[0], 'idle');
    if (!avatarActions.walk && clips[1] && !isAvatarClipDisabled(clips[1].name, disabled)) avatarActions.walk = makeActionForClip(model, clips[1], 'walk');
  }

  console.log('[Avatar GLB] animations', {
    clips: clips.map((c) => c.name),
    mapped: Object.keys(avatarActions),
    disabledRuntimeActions: Array.from(disabled),
    skippedDisabled,
    note: skippedDisabled.length ? 'Disabled clips remain in GLB but are not mapped/played at runtime.' : ''
  });

  if (avatarActions.idle) playAvatarAction('idle');
}

function getAvatarFadeTime(name, options = {}) {
  if (Number.isFinite(Number(options.fadeTime))) return Math.max(0, Number(options.fadeTime));
  if (name === 'sitdown' || name === 'situp' || name === 'sit') {
    return Math.max(0.04, Number(CONFIG.avatarSitTransitionFadeTime || CONFIG.avatarAnimationFadeTime || 0.24));
  }
  return Math.max(0.04, Number(CONFIG.avatarLocomotionFadeTime || CONFIG.avatarAnimationFadeTime || 0.26));
}

function playAvatarAction(name, options = {}) {
  if (!avatarMixer || !avatarActions) return false;
  if (isAvatarClipDisabled(name)) return false;

  const nextAction = avatarActions[name] || avatarActions.idle;
  const resolvedName = avatarActions[name] ? name : 'idle';

  if (!nextAction) return false;
  if (!options.force && nextAction === currentAvatarAction && currentAvatarActionName === resolvedName) return true;

  nextAction.enabled = true;
  nextAction.setEffectiveWeight(1);
  nextAction.setEffectiveTimeScale(Number.isFinite(Number(nextAction.timeScale)) ? nextAction.timeScale : 1);

  const shouldReset = options.reset === true || currentAvatarActionName !== resolvedName || resolvedName === 'sitdown' || resolvedName === 'situp';
  if (shouldReset) nextAction.reset();

  if (currentAvatarAction && currentAvatarAction !== nextAction) {
    currentAvatarAction.crossFadeTo(nextAction, getAvatarFadeTime(resolvedName, options), false);
  }

  nextAction.play();
  currentAvatarAction = nextAction;
  currentAvatarActionName = resolvedName;
  return true;
}

let avatarSitTransitionToken = 0;
let avatarSitTransitionTimer = 0;
let avatarSitTransitionCleanup = null;

function clearAvatarSitTransitionWatch() {
  window.clearTimeout(avatarSitTransitionTimer);
  avatarSitTransitionTimer = 0;
  if (typeof avatarSitTransitionCleanup === 'function') {
    avatarSitTransitionCleanup();
    avatarSitTransitionCleanup = null;
  }
}

function isAvatarSeatTransitionActive() {
  return avatarMotionState === 'sitting-down' || avatarMotionState === 'standing-up';
}

function getAvatarActionDuration(actionName) {
  const action = avatarActions?.[actionName];
  const clip = action?._clip;
  const duration = Number(clip?.duration || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function runAvatarSeatTransition(actionName, motionState, fallbackActionName, onComplete) {
  if (!CONFIG.avatarUseSitTransitions || !CONFIG.avatarUseSitAnimation || !avatarMixer || !avatarActions) {
    if (fallbackActionName) playAvatarAction(fallbackActionName);
    return false;
  }

  if (isAvatarClipDisabled(actionName)) {
    if (fallbackActionName) playAvatarAction(fallbackActionName);
    return false;
  }

  const action = avatarActions[actionName];
  if (!action) {
    if (fallbackActionName) playAvatarAction(fallbackActionName, { fadeTime: CONFIG.avatarSitTransitionFadeTime });
    return false;
  }

  clearAvatarSitTransitionWatch();
  avatarMotionState = motionState;
  const token = ++avatarSitTransitionToken;
  const completed = { value: false };

  const finish = (ok, reason) => {
    if (completed.value || token !== avatarSitTransitionToken) return;
    completed.value = true;
    clearAvatarSitTransitionWatch();
    onComplete?.(ok, reason || actionName);
  };

  const onFinished = (event) => {
    if (event?.action !== action) return;
    finish(true, 'finished-event');
  };

  avatarMixer.addEventListener('finished', onFinished);
  avatarSitTransitionCleanup = () => avatarMixer?.removeEventListener?.('finished', onFinished);

  const durationMs = Math.max(0, getAvatarActionDuration(actionName) * 1000 / Math.max(0.001, Number(action.timeScale || 1)));
  const fallbackMs = Math.max(
    600,
    Number(CONFIG.avatarSitTransitionFallbackMs || 2600),
    durationMs + Math.max(80, Number(CONFIG.avatarSitTransitionTimeoutPaddingMs || 220))
  );

  const started = playAvatarAction(actionName, {
    force: true,
    reset: true,
    fadeTime: CONFIG.avatarSitTransitionFadeTime
  });

  if (!started) {
    finish(false, 'play-failed');
    return false;
  }

  avatarSitTransitionTimer = window.setTimeout(() => finish(false, 'fallback-timeout'), fallbackMs);
  return true;
}

function startAvatarSitDownTransition(onComplete) {
  if (isAvatarSeatTransitionActive()) return false;
  return runAvatarSeatTransition('sitdown', 'sitting-down', 'sit', (ok, reason) => {
    avatarMotionState = 'sitting';
    if (CONFIG.avatarUseSitAnimation) playAvatarAction('sit', { fadeTime: CONFIG.avatarSitTransitionFadeTime });
    onComplete?.(ok, reason);
  });
}

function startAvatarSitUpTransition(onComplete) {
  if (isAvatarSeatTransitionActive()) return false;
  return runAvatarSeatTransition('situp', 'standing-up', 'idle', (ok, reason) => {
    onComplete?.(ok, reason);
    avatarMotionState = 'idle';
    playAvatarAction('idle', { fadeTime: CONFIG.avatarSitTransitionFadeTime });
  });
}

function updateAvatarAnimation(deltaTime) {
  if (!avatarMixer) return;

  if (isAvatarSeatTransitionActive()) {
    avatarMixer.update(deltaTime);
    return;
  }

  if (isSitting && CONFIG.avatarUseSitAnimation) {
    avatarMotionState = 'sitting';
    playAvatarAction('sit', { fadeTime: CONFIG.avatarSitTransitionFadeTime });
  } else if (CONFIG.avatarUseLocomotionAnimations) {
    const speed = avatarVelocity.length();
    const isRunning = keys['ShiftLeft'] || keys['ShiftRight'];

    if (speed > CONFIG.avatarWalkStartThreshold) {
      avatarMotionState = isRunning ? 'run' : 'walk';
    } else if (speed < CONFIG.avatarWalkStopThreshold || !['walk', 'run'].includes(avatarMotionState)) {
      avatarMotionState = 'idle';
    }

    playAvatarAction(avatarMotionState, { fadeTime: CONFIG.avatarLocomotionFadeTime });
  } else {
    avatarMotionState = 'idle';
    playAvatarAction('idle', { fadeTime: CONFIG.avatarLocomotionFadeTime });
  }

  avatarMixer.update(deltaTime);
}

window.isAvatarSeatTransitionActive = isAvatarSeatTransitionActive;
window.startAvatarSitDownTransition = startAvatarSitDownTransition;
window.startAvatarSitUpTransition = startAvatarSitUpTransition;


function syncAvatarToCameraStart() {
  if (!avatar) return;

  avatar.position.set(
    camera.position.x,
    camera.position.y - CONFIG.eyeHeight,
    camera.position.z
  );

  if (typeof snapAvatarRootToGround === 'function') {
    snapAvatarRootToGround(avatar, 'syncAvatarToCameraStart');
  }

  avatar.rotation.y = yaw;
  avatarTargetYaw = yaw;

  if (avatar.userData?.modelPivot) {
    avatar.userData.modelPivot.rotation.y = CONFIG.avatarModelYawOffset;
  }

  avatar.visible = CONFIG.avatarEnabled && viewMode === 'third';
}


function getCameraShoulderMode() {
  const mode = CONFIG.cameraShoulderMode || 'center';
  const offsets = CONFIG.cameraShoulderOffsets || {};
  if (Object.prototype.hasOwnProperty.call(offsets, mode)) return mode;
  return 'center';
}

function getCameraShoulderModeLabel(mode = getCameraShoulderMode()) {
  const labels = CONFIG.cameraShoulderModeLabels || {};
  return labels[mode] || mode;
}

function getThirdPersonShoulderOffset() {
  if (isSitting) {
    const sitOffset = Number(CONFIG.sitCameraShoulderOffset);
    return Number.isFinite(sitOffset) ? sitOffset : 0;
  }

  const mode = getCameraShoulderMode();
  const offsets = CONFIG.cameraShoulderOffsets || {};
  const modeOffset = Number(offsets[mode]);
  if (Number.isFinite(modeOffset)) return modeOffset;

  const fallback = Number(CONFIG.thirdPersonShoulderOffset);
  return Number.isFinite(fallback) ? fallback : 0;
}

function cycleCameraShoulderMode() {
  const order = Array.isArray(CONFIG.cameraShoulderModeOrder) && CONFIG.cameraShoulderModeOrder.length > 0
    ? CONFIG.cameraShoulderModeOrder
    : ['center', 'right', 'left'];

  const current = getCameraShoulderMode();
  const currentIndex = Math.max(0, order.indexOf(current));
  const nextMode = order[(currentIndex + 1) % order.length] || 'center';

  CONFIG.cameraShoulderMode = nextMode;

  if (viewMode === 'third') {
    forceAvatarCameraView();
  }

  const message = `✅ <strong>Camera: ${getCameraShoulderModeLabel(nextMode)}</strong><br><span style="opacity:.75">Nhấn C để đổi Center / Vai phải / Vai trái</span>`;
  if (typeof statusEl !== 'undefined' && statusEl) {
    statusEl.innerHTML = message;
  } else {
    setStatus(message);
  }
  return nextMode;
}

function forceAvatarCameraView() {
  if (!avatar || viewMode !== 'third') return;

  avatar.visible = true;

  const forward = new THREE.Vector3(
    Math.sin(yaw),
    0,
    Math.cos(yaw)
  ).normalize();

  const shoulderRight = new THREE.Vector3(
    -Math.cos(yaw),
    0,
    Math.sin(yaw)
  ).normalize();

  const camDistance = isSitting ? CONFIG.sitCameraDistance : CONFIG.thirdPersonDistance;
  const camHeight = isSitting ? CONFIG.sitCameraHeight : CONFIG.thirdPersonHeight;
  const shoulderOffset = getThirdPersonShoulderOffset();

  camera.position.set(
    avatar.position.x - forward.x * camDistance + shoulderRight.x * shoulderOffset,
    avatar.position.y + camHeight,
    avatar.position.z - forward.z * camDistance + shoulderRight.z * shoulderOffset
  );

  cameraLookTarget.set(
    avatar.position.x + forward.x * CONFIG.thirdPersonAimDistance,
    avatar.position.y + CONFIG.thirdPersonLookAtHeight,
    avatar.position.z + forward.z * CONFIG.thirdPersonAimDistance
  );

  camera.lookAt(cameraLookTarget);
}

function updateCameraForAvatar(deltaTime) {
  if (!avatar || viewMode !== 'third' || modalOpen) return;

  // Hướng nhìn / hướng đi chính theo chuột.
  const forward = new THREE.Vector3(
    Math.sin(yaw),
    0,
    Math.cos(yaw)
  ).normalize();

  // Camera Optimization V5.1: shoulder offset is configurable.
  // Default mode is centered for a more natural gallery-browsing view.
  const shoulderRight = new THREE.Vector3(
    -Math.cos(yaw),
    0,
    Math.sin(yaw)
  ).normalize();

  const avatarAnchor = new THREE.Vector3(
    avatar.position.x,
    avatar.position.y + CONFIG.thirdPersonLookAtHeight,
    avatar.position.z
  );

  const verticalAim = THREE.MathUtils.clamp(Math.sin(pitch) * 3.2, -1.8, 2.1);

  cameraLookTarget.set(
    avatar.position.x + forward.x * CONFIG.thirdPersonAimDistance,
    avatar.position.y + CONFIG.thirdPersonLookAtHeight + verticalAim,
    avatar.position.z + forward.z * CONFIG.thirdPersonAimDistance
  );

  const camDistance = isSitting ? CONFIG.sitCameraDistance : CONFIG.thirdPersonDistance;
  const camHeight = isSitting ? CONFIG.sitCameraHeight : CONFIG.thirdPersonHeight;
  const shoulderOffset = getThirdPersonShoulderOffset();

  cameraDesiredPosition.set(
    avatar.position.x - forward.x * camDistance + shoulderRight.x * shoulderOffset,
    avatar.position.y + camHeight,
    avatar.position.z - forward.z * camDistance + shoulderRight.z * shoulderOffset
  );

  // Chống camera phía sau avatar xuyên tường/vách.
  // Ưu tiên collider thủ công + wall fallback nhẹ, tránh dùng toàn bộ mesh gây giật.
  const blockers = colliderObjects.length > 0
    ? [...new Set([...colliderObjects, ...wallFallbackObjects])]
    : blockingObjects;
  if (blockers.length > 0) {
    const toCamera = cameraDesiredPosition.clone().sub(avatarAnchor);
    const desiredDistance = toCamera.length();

    if (desiredDistance > 0.001) {
      const cameraDir = toCamera.normalize();

      cameraCollisionRaycaster.set(avatarAnchor, cameraDir);
      cameraCollisionRaycaster.far = desiredDistance;

      const hits = cameraCollisionRaycaster.intersectObjects(blockers, true);

      for (const hit of hits) {
        if (hit.distance < 0.25) continue;

        // Bỏ qua mặt quá ngang như sàn/trần.
        if (hit.face) {
          const normal = hit.face.normal.clone();
          normal.transformDirection(hit.object.matrixWorld).normalize();
          if (Math.abs(normal.y) > 0.7) continue;
        }

        // Đặt camera ở trước mặt tường một chút, không để chui ra sau.
        cameraDesiredPosition.copy(
          hit.point.clone().addScaledVector(cameraDir, -CONFIG.cameraWallPadding)
        );
        break;
      }
    }
  }

  const smooth = 1 - Math.exp(-CONFIG.cameraFollowSmooth * deltaTime);
  camera.position.lerp(cameraDesiredPosition, smooth);
  camera.lookAt(cameraLookTarget);
}

function toggleViewMode() {
  viewMode = viewMode === 'third' ? 'first' : 'third';

  if (avatar) {
    avatar.visible = viewMode === 'third';
  }

  if (viewMode === 'first' && avatar) {
    camera.position.set(
      avatar.position.x,
      avatar.position.y + CONFIG.eyeHeight,
      avatar.position.z
    );
    camera.rotation.set(pitch, yaw, 0);
  }

  if (viewMode === 'third') {
    forceAvatarCameraView();
    setStatus(`✅ <strong>Đang tham quan</strong>`);
  } else {
    setStatus(`✅ <strong>Góc nhìn thứ nhất</strong><br>WASD: di chuyển như viewer cũ<br>Chuột: nhìn xung quanh<br>V: bật lại avatar<br>Click tranh: mở chi tiết`);
  }
}


