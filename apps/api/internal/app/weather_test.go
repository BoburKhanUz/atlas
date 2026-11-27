package app

import (
	"testing"

	"lookly/internal/config"
	"lookly/internal/weather"
)

func TestTheWeatherProviderIsTheConfigurations(t *testing.T) {
	t.Parallel()
	if got := weatherProvider(config.Config{WeatherProvider: config.WeatherMock}); got.Name() != weather.MockName {
		t.Errorf("mock: %s", got.Name())
	}
	// Whatever else the configuration held would be the real service: the
	// demo weather is answered only when it is named.
	for _, name := range []string{config.WeatherOpenMeteo, ""} {
		if got := weatherProvider(config.Config{WeatherProvider: name}); got.Name() != weather.OpenMeteoName {
			t.Errorf("%q: %s", name, got.Name())
		}
	}
}
