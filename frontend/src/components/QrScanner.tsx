import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from './ui';

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

/**
 * Camera view that reads one QR code and hands back its text. Uses the browser's own
 * barcode reader where there is one (Chrome, Android); elsewhere (iPhone, Firefox) it
 * reads the video frames with jsQR, loaded only when needed.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest callback without restarting the camera.
  const done = useRef(onResult);
  useEffect(() => {
    done.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    async function run() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot use the camera here. Type the code instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        setError('Could not open the camera. Allow camera access for this site, or type the code instead.');
        return;
      }
      const el = video.current;
      if (stopped || !el) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      el.srcObject = stream;
      await el.play().catch(() => {});

      const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      let detector: Detector | null = null;
      try {
        detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;
      } catch {
        detector = null;
      }
      const jsQR = detector ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = async () => {
        if (stopped) return;
        let text: string | undefined;
        try {
          if (el.readyState >= 2 && el.videoWidth) {
            if (detector) {
              text = (await detector.detect(el))[0]?.rawValue;
            } else if (jsQR && ctx) {
              // A small frame is enough for a QR code and keeps old phones smooth.
              const scale = Math.min(1, 480 / el.videoWidth);
              canvas.width = Math.round(el.videoWidth * scale);
              canvas.height = Math.round(el.videoHeight * scale);
              ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
              const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(frame.data, frame.width, frame.height)?.data;
            }
          }
        } catch {
          // a frame that cannot be read: try the next one
        }
        if (stopped) return;
        if (text) {
          done.current(text);
          return;
        }
        timer = setTimeout(() => void tick(), 200);
      };
      void tick();
    }
    void run();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Modal open onClose={onClose} title="Scan the QR code">
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      ) : (
        <>
          <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-black">
            <video ref={video} muted playsInline className="h-full w-full object-cover" aria-label="Camera view" />
            <div className="pointer-events-none absolute inset-6 rounded-2xl border-4 border-white/80" aria-hidden />
          </div>
          <p className="mt-3 text-center text-sm text-muted">Point the camera at the QR code on the host's screen.</p>
        </>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
