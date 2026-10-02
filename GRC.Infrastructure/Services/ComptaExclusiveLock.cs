using System;
using System.Threading;
using GRC.Application.Interfaces;
using Microsoft.Extensions.Logging;

namespace GRC.Infrastructure.Services
{
    public sealed class ComptaExclusiveLock : IComptaExclusiveLock
    {
        private readonly object _syncRoot = new();
        private readonly ILogger<ComptaExclusiveLock>? _logger;
        private ComptaLockHolder? _current;

        public ComptaExclusiveLock(ILogger<ComptaExclusiveLock>? logger = null)
        {
            _logger = logger;
        }

        public bool TryEnter(string operation, int userId, int count, out IDisposable? handle, out ComptaLockHolder? holder)
        {
            lock (_syncRoot)
            {
                if (_current != null)
                {
                    holder = _current;
                    handle = null;
                    return false;
                }

                _current = new ComptaLockHolder(operation, userId, count, DateTime.Now);
                holder = null;
                _logger?.LogInformation(
                    "Verrou compta acquis : operation={Operation}, userId={UserId}, count={Count}, startedAt={StartedAt:HH:mm:ss}",
                    _current.Operation, _current.UserId, _current.Count, _current.StartedAt);
                handle = new LockHandle(this, _current);
                return true;
            }
        }

        private void Release(ComptaLockHolder holder)
        {
            lock (_syncRoot)
            {
                if (object.ReferenceEquals(_current, holder))
                {
                    var duration = DateTime.Now - holder.StartedAt;
                    _current = null;
                    _logger?.LogInformation(
                        "Verrou compta libéré : operation={Operation}, userId={UserId}, durée={DurationTotalSeconds:F1}s",
                        holder.Operation, holder.UserId, duration.TotalSeconds);
                }
            }
        }

        private sealed class LockHandle : IDisposable
        {
            private readonly ComptaExclusiveLock _parent;
            private readonly ComptaLockHolder _holder;
            private int _disposed;

            public LockHandle(ComptaExclusiveLock parent, ComptaLockHolder holder)
            {
                _parent = parent;
                _holder = holder;
            }

            public void Dispose()
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 0)
                {
                    _parent.Release(_holder);
                }
            }
        }
    }
}
