using System;
using System.Security.Cryptography;
using System.Text;

namespace OutlookCompanion
{
    internal enum SyncGroup
    {
        EvenHours = 0,
        OddHours = 1
    }

    /// <summary>
    /// Multiple PC Companions share one Firestore dataset but avoid doing the same scan at the same time.
    /// Each PC is deterministically assigned to A or B from its persistent anonymous sourcePc id.
    /// No user choice is exposed: as long as companion-config.txt is retained, that PC stays in the same group.
    /// </summary>
    internal static class SyncSchedule
    {
        public static SyncGroup AssignedGroup()
        {
            FirestoreConfig cfg = FirestoreConfig.Load();
            return AssignedGroupForSourcePc(cfg.SourcePc);
        }

        internal static SyncGroup AssignedGroupForSourcePc(string sourcePc)
        {
            string value = sourcePc ?? "";
            byte[] bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
            return (bytes[0] & 1) == 0 ? SyncGroup.EvenHours : SyncGroup.OddHours;
        }

        public static DateTime NextSlot(DateTime localNow, SyncGroup group)
        {
            DateTime candidate = localNow;
            if (!ActiveHours.IsAutomaticSyncAllowed(candidate))
            {
                candidate = candidate.Date.AddHours(ActiveHours.StartHour);
            }

            DateTime top = new DateTime(candidate.Year, candidate.Month, candidate.Day, candidate.Hour, 0, 0, candidate.Kind);
            if (candidate > top) top = top.AddHours(1);

            int parity = group == SyncGroup.EvenHours ? 0 : 1;
            if ((top.Hour & 1) != parity) top = top.AddHours(1);

            if (!ActiveHours.IsAutomaticSyncAllowed(top))
            {
                DateTime morning = top.Date.AddHours(ActiveHours.StartHour);
                if ((morning.Hour & 1) != parity) morning = morning.AddHours(1);
                top = morning;
            }

            return top;
        }

        public static string Label(SyncGroup group) =>
            group == SyncGroup.EvenHours ? "A · 짝수시" : "B · 홀수시";
    }
}
