# Public verification tests

Status: CURRENT. Run `python -m pytest -q` from the repository root after installing
`requirements.txt`. This suite covers the retained ADR runtime, signing failure,
verification, gateway and control API behavior, SDK and 15 frozen normative vectors.
It does not validate the removed private application surfaces.

All fixed test signing keys are TEST ONLY / PUBLIC / NON SECRET. Never use them
in production. The D-006 and site suites run separately; see the root README.
