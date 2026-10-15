import { useI18n } from "../i18n/context";
import { Seo } from "./Seo";
import { Navigation } from "../components/navigation/Navigation";
import { Hero } from "../components/hero/Hero";
import { ProofJourney } from "../components/cinematic-scene/ProofJourney";
import { ControlGap } from "../components/sections/ControlGap";
import { HowItWorks } from "../components/sections/HowItWorks";
import { IndependentByDesign } from "../components/sections/IndependentByDesign";
import { PebIntake } from "../components/verifier/PebIntake";
import { VerificationLayers } from "../components/verifier/VerificationLayers";
import { UseCases } from "../components/use-cases/UseCases";
import { Architecture } from "../components/architecture/Architecture";
import { Standards } from "../components/sections/Standards";
import { OpenVerification } from "../components/sections/OpenVerification";
import { FinalStatement } from "../components/sections/FinalStatement";
import { Footer } from "../components/footer/Footer";

export function App() {
  const { t } = useI18n();

  return (
    <div className="fortix-site">
      <Seo />
      <a className="skip-link" href="#main-content">
        {t.nav.skipToContent}
      </a>
      <Navigation />
      <main id="main-content">
        <Hero />
        <ControlGap />
        <IndependentByDesign />
        <HowItWorks />
        <ProofJourney />
        <UseCases />
        <VerificationLayers />
        <PebIntake />
        <Architecture />
        <Standards />
        <OpenVerification />
        <FinalStatement />
      </main>
      <Footer />
    </div>
  );
}
