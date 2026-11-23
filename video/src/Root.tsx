import '@fontsource-variable/dm-sans/wght.css';
import { Composition } from 'remotion';
import { Intro, INTRO_FRAMES } from './Intro';

/** The landing page walkthrough: 1280 x 720, 30 frames a second. */
export function Root() {
  return <Composition id="Intro" component={Intro} durationInFrames={INTRO_FRAMES} fps={30} width={1280} height={720} />;
}
