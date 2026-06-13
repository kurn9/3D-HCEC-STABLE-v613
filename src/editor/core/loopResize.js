function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  updateMovement(dt);

  probeTimer += dt;
  if (probeTimer >= 0.1) {
    probeTimer = 0;
    checkCenterTarget();
  }

  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = dom.viewport.clientWidth / dom.viewport.clientHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(dom.viewport.clientWidth, dom.viewport.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
