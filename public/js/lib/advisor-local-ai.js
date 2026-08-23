/**
 * Run one Advisor Gemma request with cancellation wired to the shared Advisor
 * stream controller. The caller owns UI updates; cancelled partials/results are
 * intentionally suppressed.
 */
export async function runCancellableAdvisorInference({
  prompt,
  runInference,
  onPartial,
  setActiveController,
  clearActiveController,
  controller = new AbortController(),
}) {
  setActiveController(controller);
  try {
    const result = await runInference(prompt, partial => {
      if (!controller.signal.aborted) onPartial?.(partial);
    }, { signal: controller.signal });
    return controller.signal.aborted ? null : result;
  } catch (error) {
    if (error?.code === 'LOCAL_AI_CANCELLED' || controller.signal.aborted) return null;
    throw error;
  } finally {
    clearActiveController(controller);
  }
}