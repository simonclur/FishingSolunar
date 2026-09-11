# Third-party notices

## SunCalc (moon algorithms)

`js/astro.js` adapts the moon position / rise-set / illumination functions
from **SunCalc** by Volodymyr Agafonkin.

- Source: <https://github.com/mourner/suncalc>
- Licence: BSD-2-Clause

```
Copyright (c) 2026, Volodymyr Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Only the moon-related functions (`getMoonPosition`, `getMoonTimes`,
`getMoonIllumination` and their private helpers) were ported; the sun-position
code was omitted since sunrise/sunset are sourced from the Open-Meteo weather
API instead.

## Data APIs (not bundled code, called at runtime)

- [Open-Meteo](https://open-meteo.com/) — weather & marine forecast (CC BY 4.0 data licence, free for non-commercial use)
- [WorldTides](https://www.worldtides.info/) — tide predictions (commercial API, user-supplied key)
