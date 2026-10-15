/** Captions only, keyed by the event actually present in a received member. */
const events: Readonly<Record<string, readonly [string, string]>> = {
  "d005.receipt.passenger": ["Passenger mission dossier", "Dossier de mission passager"],
  "d005.receipt.traffic": ["Traffic evidence dossier", "Dossier de preuves de circulation"],
  "d005.receipt.maintenance": ["Maintenance evidence dossier", "Dossier de preuves de maintenance"],
  "d005m.master-payment-trusted-time": ["Payment trusted time recorded", "Temps de confiance du paiement enregistré"],
  "d005.maintenance-authority-later-revoked": ["Maintenance authority later revoked", "Autorité de maintenance révoquée ultérieurement"],
  "d005.maintenance-authority-active": ["Maintenance authority active", "Autorité de maintenance active"],
  "d005.demo-trusted-time": ["Mission trusted time recorded", "Temps de confiance de la mission enregistré"],
  "d005.demo-trust-anchor-activation": ["Trust anchor activated", "Ancre de confiance activée"],
  "d005m.master-payment-authority-revoked": ["Payment authority revoked", "Autorité de paiement révoquée"],
  "d005.passenger-request": ["Passenger requests a taxi", "Le passager demande un taxi"],
  "d005.passenger-authority": ["Passenger mission authorized", "Mission passager autorisée"],
  "d005.mission-accepted": ["The taxi accepts the mission", "Le taxi accepte la mission"],
  "d006nx0.action:depart-base": ["The taxi leaves the base", "Le taxi quitte la base"],
  "d005.pickup-route": ["Route to the passenger", "Itinéraire vers le passager"],
  "d006g.signal-state-published:green-1": ["The signal is green", "Le feu est vert"],
  "d006g.city-detection": ["The city detects a vehicle", "La ville détecte un véhicule"],
  "d006g.signal-state-published:yellow": ["The signal turns yellow", "Le feu passe à l’orange"],
  "d006g.perception:yellow": ["The taxi observes yellow", "Le taxi perçoit le feu orange"],
  "d006g.decision:stop": ["The taxi decides to stop", "Le taxi décide de s’arrêter"],
  "d006g.action:brake": ["The taxi brakes", "Le taxi freine"],
  "d006g.signal-state-published:red": ["The signal turns red", "Le feu passe au rouge"],
  "d006g.result:at-rest": ["The taxi is stopped", "Le taxi est immobilisé"],
  "d006g.city-phase-decision": ["The city selects the next signal phase", "La ville choisit la phase suivante du feu"],
  "d006g.signal-state-published:green-2": ["The signal turns green", "Le feu passe au vert"],
  "d006g.perception:green": ["The taxi observes green", "Le taxi perçoit le feu vert"],
  "d006g.decision:proceed": ["The taxi decides to proceed", "Le taxi décide de repartir"],
  "d006g.action:resume": ["The taxi resumes driving", "Le taxi redémarre"],
  "d005.pickup-confirmed": ["Passenger pickup confirmed", "Embarquement du passager confirmé"],
  "d005.journey-executed": ["Passenger journey executed", "Trajet du passager effectué"],
  "d005.dropoff-confirmed": ["Passenger drop-off confirmed", "Dépose du passager confirmée"],
  "d005.maintenance-intent": ["Maintenance mission requested", "Mission de maintenance demandée"],
  "d005.garage-route-a": ["Route to the garage", "Itinéraire vers le garage"],
  "d005.congestion-significant": ["Traffic congestion reported", "Ralentissements signalés"],
  "d006nx0.perception:congestion": ["The taxi detects the queue", "Le taxi repère la file de véhicules"],
  "d006nx0.decision:hazard-stop": ["The taxi decides to stop before the queue", "Le taxi décide de s’arrêter avant la file"],
  "d005.eta-deteriorates": ["Arrival is delayed", "L’arrivée est retardée"],
  "d006nx0.action:hazard-brake": ["The taxi brakes before the queue", "Le taxi freine avant la file"],
  "d006nx0.result:hazard-stop": ["The taxi stops before the queue", "Le taxi s’immobilise avant la file"],
  "d005.reroute-authorized": ["A new route is authorized", "Un nouvel itinéraire est autorisé"],
  "d006.c1.routing-provenance": ["Route selection recorded", "Sélection d’itinéraire enregistrée"],
  "d005.route-b-executed": ["The alternative route is executed", "L’itinéraire alternatif est exécuté"],
  "d006nx0.action:reroute": ["The taxi follows the new route", "Le taxi emprunte le nouvel itinéraire"],
  "d005.garage-arrival": ["The taxi arrives at the garage", "Le taxi arrive au garage"],
  "d005.garage-received": ["The garage receives the vehicle", "Le garage reçoit le véhicule"],
  "d005.diagnostic": ["Maintenance diagnosis", "Diagnostic de maintenance"],
  "d005.maintenance-proposal": ["Maintenance work proposed", "Travaux de maintenance proposés"],
  "d005.maintenance-authorized": ["Maintenance authorized", "Maintenance autorisée"],
  "d005.maintenance-executed": ["Maintenance work executed", "Travaux de maintenance exécutés"],
  "d005.maintenance-completed": ["Maintenance completed", "Maintenance terminée"],
  "d005m.master-invoice-1850": ["The garage issues an invoice", "Le garage émet une facture"],
  "d005m.master-payment-policy-exceeded": ["The invoice exceeds the autonomous limit", "La facture dépasse la limite autonome"],
  "d005m.master-human-approval-request": ["Human approval requested", "Approbation humaine demandée"],
  "d005m.master-human-approve": ["A manager authorizes payment", "Un responsable autorise le paiement"],
  "d005m.master-payment-authority-active": ["Payment authority declared", "Autorité de paiement déclarée"],
  "d005m.master-payment-authorized": ["Payment instruction authorized", "Instruction de paiement autorisée"],
  "d005m.master-payment-instruction": ["Payment instruction issued", "Instruction de paiement émise"],
  "d006g.payment-instruction-presented": ["Instruction presented to the bank", "Instruction transmise à la banque"],
  "d006g.bank-authorization": ["Bank authorization", "Autorisation bancaire"],
  "d006g.bank-confirmation": ["Bank authorization confirmed", "Autorisation bancaire confirmée"],
  "d005m.master-payment-result": ["Simulated payment result recorded", "Résultat de paiement simulé enregistré"],
  "d005m.receipt.master-payment": ["Payment dossier compiled", "Dossier de paiement compilé"],
  "d005m.master-manager-notified": ["The manager is informed", "Le responsable est informé"],
  "d005m.master-return-intent": ["Return to base requested", "Retour à la base demandé"],
  "d005m.master-return-authorized": ["Return route authorized", "Itinéraire de retour autorisé"],
  "d005m.master-return-executed": ["The taxi returns to base", "Le taxi retourne à la base"],
  "d005m.master-base-arrival": ["The taxi arrives at the base", "Le taxi arrive à la base"],
  "d005m.receipt.master-return-to-base": ["Return mission receipt", "Reçu de la mission de retour"],
  "d005m.receipt.master-operational-cycle": ["Operational cycle receipt", "Reçu du cycle opérationnel"],
  "d006.final-mission-receipt": ["Final Receipt", "Reçu final"],
};
export function receivedEventLabel(eventId: string | null | undefined, locale: "en" | "fr"): string | null {
  if (!eventId) return null;
  // A neutral caption: whether it reconciled anything is the Network view's
  // reading of the period, never a property of the identifier.
  if (eventId.startsWith("d006d.reconciliation-complete:")) return locale === "fr" ? "Reçu de réconciliation" : "Reconciliation receipt";
  // Both declared forms: "d006d.network-link-lost:<id>" and "<run>:network:<n>:NETWORK_LINK_LOST".
  const last = eventId.split(":").at(-1);
  const network = eventId.startsWith("d006d.network-link-lost:") || last === "NETWORK_LINK_LOST"
    ? ["Network lost", "Réseau perdu"] as const
    : eventId.startsWith("d006d.network-link-restored:") || last === "NETWORK_LINK_RESTORED"
      ? ["Network restored", "Réseau rétabli"] as const
      : null;
  return (events[eventId] ?? network)?.[locale === "fr" ? 1 : 0] ?? null;
}

const producers: Readonly<Record<string, string>> = {
  "Passenger service": "Service passagers", "Taxi autonomy": "Conduite autonome", AUTONOMOUS_VEHICLE: "Véhicule autonome",
  SMART_CITY_INFRASTRUCTURE: "Ville connectée", "Traffic Provider": "Information trafic", "Navigation Provider A": "Navigation A", "Navigation Provider B": "Navigation B",
  ROUTING_ORCHESTRATOR: "Sélection d’itinéraire", "Fleet operations": "Exploitation de la flotte", "Maintenance system": "Maintenance", Garage: "Garage",
  "Payment policy": "Politique de paiement", "Manager workflow": "Responsable humain", "Payment Provider": "Prestataire de paiement", PAYMENT_PROVIDER: "Prestataire de paiement",
  FINANCIAL_INSTITUTION: "Banque", HUMAN_APPROVER: "Approbateur humain", NETWORK: "Sentinelle réseau", "FortiX causal compiler": "Compilateur causal FortiX",
};
const technicalProducers: Readonly<Record<string, readonly [string, string]>> = {
  AUTONOMOUS_VEHICLE: ["Autonomous vehicle", "Véhicule autonome"],
  SMART_CITY_INFRASTRUCTURE: ["Smart city infrastructure", "Ville connectée"],
  ROUTING_ORCHESTRATOR: ["Routing orchestrator", "Sélection d’itinéraire"],
  NETWORK: ["Network sentinel", "Sentinelle réseau"],
  "fortix.demo.causal-compiler.d005": ["Causal compiler · passenger mission", "Compilateur causal · mission passager"],
  "fortix.demo.causal-compiler.d005m": ["Causal compiler · operational cycle", "Compilateur causal · cycle opérationnel"],
  "fortix.demo.governance.d005": ["Maintenance governance", "Gouvernance de maintenance"],
  "fortix.demo.governance.d005m": ["Payment governance", "Gouvernance de paiement"],
  "fortix.demo.time-source.d005": ["Trusted time source · mission", "Source de temps de confiance · mission"],
  "fortix.demo.time-source.d005m": ["Trusted time source · payment", "Source de temps de confiance · paiement"],
  "fortix.demo.trust-authority.d005": ["Trust authority", "Autorité de confiance"],
  "fortix.demo.manager-authority.d005m": ["Manager authority", "Autorité du responsable"],
  FINANCIAL_INSTITUTION: ["Bank", "Banque"],
  "Payment Provider": ["Payment provider · mission", "Prestataire de paiement · mission"],
  PAYMENT_PROVIDER: ["Payment provider · bank", "Prestataire de paiement · banque"],
  HUMAN_APPROVER: ["Human approver", "Approbateur humain"],
};
export function receivedProducerLabel(producer: string, locale: "en" | "fr"): string {
  return technicalProducers[producer]?.[locale === "fr" ? 1 : 0] ?? (locale === "fr" ? producers[producer] ?? producer : producer);
}
