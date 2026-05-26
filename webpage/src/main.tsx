import { render } from 'preact';
import { App } from './App';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/base-layer.css';
import './workspaces/worldcup/worldcup-panel-skin.css';

render(<App />, document.getElementById('app')!);
