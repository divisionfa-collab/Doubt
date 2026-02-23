'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================
// Cinematic Overlay Controller
// EO-03: Phase transitions + Kill effects + Execution blood
// ============================================

interface OverlayState {
  phaseTransition: boolean;
  phaseIcon: string;
  phaseName: string;
  phaseSubtext: string;
  nightKillBlood: boolean;       // hands.png during night (slow dramatic)
  executionBlood: boolean;       // hands.png during vote (fast violent)
  screenShake: boolean;
  whiteFlash: boolean;
  darkOverlay: boolean;
}

const PHASE_CINEMATICS: Record<string, { icon: string; name: string; subtext: string }> = {
  NIGHT:      { icon: '🌙', name: 'الليل',    subtext: 'المافيا تتحرك في الظلام...' },
  MORNING:    { icon: '🌅', name: 'الصباح',   subtext: 'المدينة تستيقظ...' },
  DISCUSSION: { icon: '💬', name: 'النقاش',   subtext: 'تحدثوا... قبل فوات الأوان' },
  VOTING:     { icon: '🗳️', name: 'التصويت',  subtext: 'من تشكّون فيه؟' },
  RESULT:     { icon: '📊', name: 'النتيجة',  subtext: 'القرار اتُّخذ...' },
  GAME_OVER:  { icon: '🏁', name: 'انتهت',    subtext: '' },
};

const EMPTY_STATE: OverlayState = {
  phaseTransition: false,
  phaseIcon: '', phaseName: '', phaseSubtext: '',
  nightKillBlood: false, executionBlood: false,
  screenShake: false, whiteFlash: false, darkOverlay: false,
};

export function useCinematicOverlay() {
  const [state, setState] = useState<OverlayState>({ ...EMPTY_STATE });
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const executionActiveRef = useRef(false);
  const nightKillActiveRef = useRef(false);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      fn();
      timersRef.current = timersRef.current.filter(t => t !== id);
    }, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // ===== NIGHT KILL: hands.png slow fade (players sleeping) =====
  useEffect(() => {
    const handler = () => {
      if (nightKillActiveRef.current) return;
      nightKillActiveRef.current = true;

      // hands.png appears slowly, stays 6s, fades before morning at 8s
      setState(prev => ({ ...prev, nightKillBlood: true }));
      safeTimeout(() => {
        setState(prev => ({ ...prev, nightKillBlood: false }));
        nightKillActiveRef.current = false;
      }, 6000);
    };

    window.addEventListener('night_kill_effect', handler);
    return () => window.removeEventListener('night_kill_effect', handler);
  }, [safeTimeout]);

  // ===== VOTE EXECUTION: hands.png fast + flash + shake =====
  useEffect(() => {
    const handler = () => {
      if (executionActiveRef.current) return;
      executionActiveRef.current = true;

      setState(prev => ({ ...prev, whiteFlash: true, screenShake: true }));
      safeTimeout(() => setState(prev => ({ ...prev, whiteFlash: false, executionBlood: true })), 80);
      safeTimeout(() => setState(prev => ({ ...prev, screenShake: false })), 250);
      safeTimeout(() => {
        setState(prev => ({ ...prev, executionBlood: false }));
        executionActiveRef.current = false;
      }, 2500);
    };

    window.addEventListener('execution_blood', handler);
    return () => window.removeEventListener('execution_blood', handler);
  }, [safeTimeout]);

  const triggerPhaseTransition = useCallback((phase: string) => {
    const cinematic = PHASE_CINEMATICS[phase];
    if (!cinematic) return;

    clearAllTimers();
    executionActiveRef.current = false;
    nightKillActiveRef.current = false;

    setState({
      ...EMPTY_STATE,
      phaseTransition: true, darkOverlay: true,
      phaseIcon: cinematic.icon, phaseName: cinematic.name, phaseSubtext: cinematic.subtext,
    });

    safeTimeout(() => setState(prev => ({ ...prev, phaseTransition: false })), 1500);
    safeTimeout(() => setState(prev => ({ ...prev, darkOverlay: false })), 2000);
  }, [clearAllTimers, safeTimeout]);

  const triggerBloodSplash = useCallback(() => {
    // kept for vote elimination trigger from page
    setState(prev => ({ ...prev, nightKillBlood: true }));
    safeTimeout(() => setState(prev => ({ ...prev, nightKillBlood: false })), 2500);
  }, [safeTimeout]);

  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  return { overlayState: state, triggerPhaseTransition, triggerBloodSplash };
}

// ============================================
// Overlay Component
// ============================================

interface CinematicOverlayProps {
  state: OverlayState;
}

export function CinematicOverlay({ state }: CinematicOverlayProps) {
  return (
    <>
      {/* Film Grain */}
      <div className={`cinema-grain ${(state.executionBlood || state.nightKillBlood) ? 'opacity-0' : ''}`} />

      {/* Screen shake */}
      {state.screenShake && <style>{`body { animation: screenShake 0.15s ease-in-out; }`}</style>}

      {/* White flash (vote execution only) */}
      <div className={`fixed inset-0 bg-white z-[100] pointer-events-none transition-opacity duration-75
        ${state.whiteFlash ? 'opacity-30' : 'opacity-0'}`}
      />

      {/* Dark overlay for phase transitions */}
      <div className={`fixed inset-0 bg-black/80 z-40 transition-opacity duration-300 pointer-events-none
        ${state.darkOverlay ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Phase transition title */}
      <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-none
        transition-all duration-500
        ${state.phaseTransition ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
        <div className="text-7xl mb-4 cinema-float">{state.phaseIcon}</div>
        <h1 className="text-4xl font-bold text-white mb-2 cinema-glow">{state.phaseName}</h1>
        <p className="text-lg text-white/60">{state.phaseSubtext}</p>
      </div>

      {/* NIGHT KILL: hands.png - slow dramatic appearance while sleeping */}
      {state.nightKillBlood && (
        <div className="night-kill-overlay">
          <img src="/images/hands.png" alt="" />
        </div>
      )}

      {/* VOTE EXECUTION: hands.png - fast violent appearance */}
      {state.executionBlood && (
        <div className="execution-overlay">
          <img src="/images/hands.png" alt="" />
        </div>
      )}
    </>
  );
}
