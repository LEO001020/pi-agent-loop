from typing_extensions import deprecated

from zmq.constants import DeviceType
from zmq.error import *

from .context import *
from .frame import *
from .poll import *
from .socket import *
from .tracker import *
from .version import *

__all__ = [
    'device',
    'Context',
    'SyncContext',
    'DraftFDWarning',
    'ZMQBaseError',
    'ZMQBindError',
    'ZMQError',
    'NotDone',
    'ContextTerminated',
    'InterruptedSystemCall',
    'Again',
    'ZMQVersionError',
    'Frame',
    'Message',
    'Poller',
    'select',
    'Socket',
    'SyncSocket',
    'MessageTracker',
    '_FINISHED_TRACKER',
    'zmq_version',
    'zmq_version_info',
    'pyzmq_version',
    'pyzmq_version_info',
    '__version__',
    '__revision__',
    'Stopwatch',
]

@deprecated("use zmq.proxy instead")
def device(device_type: DeviceType, frontend: Socket, backend: Socket) -> int: ...

@deprecated("use time.monotonic() or time.perf_counter() instead")
class Stopwatch:
    def __init__(self) -> None: ...
    def start(self) -> None: ...
    def stop(self) -> int: ...
