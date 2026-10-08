"""Small-sample experimentation: Beta-Binomial posteriors, Thompson sampling,
expected-loss decisions, and priors pooled from the business's own history.

A small business sees tens of redemptions, not thousands, so p-values never arrive.
We decide when the expected loss of picking the leader is below a threshold.
"""

from dataclasses import dataclass

import numpy as np


@dataclass
class Arm:
    id: str
    successes: int
    trials: int
    prior_a: float = 1.0
    prior_b: float = 1.0

    @property
    def alpha(self) -> float:
        return self.prior_a + self.successes

    @property
    def beta(self) -> float:
        return self.prior_b + max(self.trials, self.successes) - self.successes


def _samples(arms: list[Arm], draws: int, rng: np.random.Generator) -> np.ndarray:
    return np.column_stack([rng.beta(a.alpha, a.beta, size=draws) for a in arms])


def summarize(arms: list[Arm], *, draws: int = 20000, seed: int = 7) -> dict[str, dict[str, float]]:
    if not arms:
        return {}
    s = _samples(arms, draws, np.random.default_rng(seed))
    best = s.argmax(axis=1)
    loss = s.max(axis=1, keepdims=True) - s
    return {
        a.id: {
            "successes": a.successes,
            "trials": a.trials,
            "mean": float(a.alpha / (a.alpha + a.beta)),
            "ci90_low": float(np.quantile(s[:, i], 0.05)),
            "ci90_high": float(np.quantile(s[:, i], 0.95)),
            "p_best": float((best == i).mean()),
            "expected_loss": float(loss[:, i].mean()),
        }
        for i, a in enumerate(arms)
    }


def thompson_allocate(arms: list[Arm], n: int, *, seed: int | None = None) -> dict[str, int]:
    """Split the next n exposures (e.g. a WhatsApp batch) by posterior probability of being best."""
    rng = np.random.default_rng(seed)
    winners = _samples(arms, n, rng).argmax(axis=1)
    return {a.id: int((winners == i).sum()) for i, a in enumerate(arms)}


@dataclass
class Decision:
    winner: str | None
    reason: str
    summary: dict[str, dict[str, float]]


def decide(arms: list[Arm], *, loss_threshold: float = 0.01, min_trials: int = 15, seed: int = 7) -> Decision:
    """Stop when the leader's expected loss (in conversion-rate points) is under the threshold."""
    summary = summarize(arms, seed=seed)
    if len(arms) < 2:
        return Decision(None, "Needs at least two variants.", summary)
    thin = [a.id for a in arms if a.trials < min_trials]
    if thin:
        return Decision(None, f"Waiting for at least {min_trials} trials per variant.", summary)
    leader = min(summary, key=lambda k: summary[k]["expected_loss"])
    s = summary[leader]
    if s["expected_loss"] <= loss_threshold:
        return Decision(leader, f"P(best)={s['p_best']:.0%}, expected loss {s['expected_loss']:.2%} "
                                f"is under {loss_threshold:.0%}.", summary)
    return Decision(None, f"Leader has P(best)={s['p_best']:.0%}; expected loss {s['expected_loss']:.2%} "
                          f"is still above {loss_threshold:.0%}.", summary)


def prior_from_history(history: list[tuple[int, int]], *, strength: float = 20.0) -> tuple[float, float]:
    """Pool past (successes, trials) into a Beta prior worth `strength` pseudo-trials."""
    s = sum(x for x, _ in history)
    t = sum(max(n, x) for x, n in history)
    if t == 0:
        return 1.0, 1.0
    mean = min(max(s / t, 1e-3), 1 - 1e-3)
    return mean * strength, (1 - mean) * strength
