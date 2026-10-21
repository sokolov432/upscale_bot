import unittest
from decimal import Decimal
from signals import Bar, closed_bars, evaluate, heikin_ashi, next_check_time, price_pattern, stop_price, volume_blockers


class SignalTests(unittest.TestCase):
    def bar(self, i, op=10, hi=12, lo=8, cl=11, volume=10):
        return Bar(i*300, op, hi, lo, cl, volume)

    def test_ha_is_causal_and_uses_previous_ha(self):
        raw = [self.bar(0, 10, 14, 8, 12), self.bar(1, 12, 16, 10, 14)]
        ha = heikin_ashi(raw)
        self.assertEqual((ha[0].open, ha[0].close), (11, 11))
        self.assertEqual((ha[1].open, ha[1].close), (11, 13))
        self.assertEqual(heikin_ashi(raw+[self.bar(2, 99, 100, 98, 99)])[:2], ha)

    def test_incomplete_bar_is_not_used(self):
        data = {"s":"ok", "t":[0,300], "o":[10,10], "h":[12,12],
                "l":[8,8], "c":[11,11], "v":[1,2]}
        self.assertEqual(len(closed_bars(data, 599)), 1)
        self.assertEqual(len(closed_bars(data, 600)), 2)

    def test_duplicate_history_is_rejected(self):
        data = {"s":"ok", "t":[0,0], "o":[10,10], "h":[12,12],
                "l":[8,8], "c":[11,11]}
        with self.assertRaises(ValueError):
            closed_bars(data, 1000)

    def test_reversal_needs_two_opposite_bars_and_body_breakouts(self):
        ha = [self.bar(0, cl=9), self.bar(1, cl=9), self.bar(2, hi=13, cl=12),
              self.bar(3, op=11, hi=15, cl=14), self.bar(4, op=12, hi=17, cl=16)]
        self.assertEqual(price_pattern(ha), "long")
        self.assertIsNone(price_pattern([self.bar(0)]+ha[1:]))
        self.assertIsNone(price_pattern(ha[:-1]+[self.bar(5, hi=17, cl=16)]))

    def test_short_is_mirrored_with_body_below_previous_wick(self):
        ha = [self.bar(0), self.bar(1), self.bar(2, lo=7, cl=9),
              self.bar(3, lo=5, cl=6), self.bar(4, lo=3, cl=4)]
        self.assertEqual(price_pattern(ha), "short")

    def test_higher_wicks_without_two_body_breakouts_are_rejected(self):
        prefix = [self.bar(0, cl=9), self.bar(1, cl=9)]
        first = self.bar(2, hi=13, cl=12)
        # Both wicks rise, but neither close exceeds the previous wick.
        self.assertIsNone(price_pattern(prefix+[first, self.bar(3, hi=15, cl=12),
                                               self.bar(4, hi=17, cl=14)]))
        # Only the first of the two required breakouts succeeds.
        self.assertIsNone(price_pattern(prefix+[first, self.bar(3, hi=15, cl=14),
                                               self.bar(4, hi=17, cl=14.5)]))
        # A close exactly at the previous wick is also insufficient.
        self.assertIsNone(price_pattern(prefix+[first, self.bar(3, hi=15, cl=13),
                                               self.bar(4, hi=17, cl=16)]))

    def test_lower_wicks_without_two_body_breakouts_are_rejected(self):
        prefix = [self.bar(0), self.bar(1)]
        first = self.bar(2, lo=7, cl=9)
        for second, third in [(self.bar(3, lo=5, cl=8), self.bar(4, lo=3, cl=6)),
                              (self.bar(3, lo=5, cl=6), self.bar(4, lo=3, cl=6)),
                              (self.bar(3, lo=5, cl=7), self.bar(4, lo=3, cl=4))]:
            with self.subTest(second=second, third=third):
                self.assertIsNone(price_pattern(prefix+[first, second, third]))

    def test_volume_strict_ladder_is_rejected_but_plateau_is_allowed(self):
        bars = [self.bar(i, volume=v) for i,v in enumerate([1,2,3])]
        self.assertEqual(volume_blockers(bars, "native_volume"), ["volumes_strictly_increasing"])
        bars[-1] = self.bar(2, volume=2)
        self.assertEqual(volume_blockers(bars, "native_volume"), [])

    def test_zero_or_missing_volume_never_silently_passes(self):
        self.assertIn("native_volume_unusable", volume_blockers([self.bar(i, volume=0) for i in range(3)], "native_volume"))
        self.assertIn("volume_source_decision_pending", volume_blockers([self.bar(i) for i in range(3)], "pending"))
        self.assertEqual(volume_blockers([self.bar(i, volume=None) for i in range(3)], "disabled_by_user"), [])

    def test_stop_is_price_fraction_not_leveraged_pnl(self):
        self.assertEqual(stop_price("158.15", "long"), Decimal("158.070925"))
        self.assertEqual(stop_price("158.15", "short"), Decimal("158.229075"))
        self.assertEqual(Decimal(6000)*30*Decimal("0.0005"), Decimal(90))

    def test_schedule_is_aligned_and_does_not_drift(self):
        self.assertEqual(next_check_time(301), 302)
        self.assertEqual(next_check_time(302), 602)
        self.assertEqual(next_check_time(305), 602)
        self.assertEqual(next_check_time(598), 602)

    def test_late_check_is_blocked(self):
        bars = [self.bar(i) for i in range(100)]
        self.assertIn("outside_close_check_window", evaluate(bars, "disabled_by_user", 30006)["blockers"])
        self.assertNotIn("outside_close_check_window", evaluate(bars, "disabled_by_user", 30002)["blockers"])


if __name__ == "__main__":
    unittest.main()
