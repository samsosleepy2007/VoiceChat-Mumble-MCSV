from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PlayerState:
    name: str
    xuid: str
    uuid: str
    dimension: str
    x: float
    y: float
    z: float
    yaw: float
    pitch: float
    voice_enabled: bool = True

    def changed_from(
        self,
        other: "PlayerState",
        position_epsilon: float,
        rotation_epsilon: float,
    ) -> bool:
        return (
            self.name != other.name
            or self.voice_enabled != other.voice_enabled
            or self.dimension != other.dimension
            or abs(self.x - other.x) >= position_epsilon
            or abs(self.y - other.y) >= position_epsilon
            or abs(self.z - other.z) >= position_epsilon
            or abs(self.yaw - other.yaw) >= rotation_epsilon
            or abs(self.pitch - other.pitch) >= rotation_epsilon
        )
