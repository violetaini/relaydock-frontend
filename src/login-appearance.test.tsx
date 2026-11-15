import {render,cleanup,fireEvent} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {LoginScreen} from './auth-screens';
import {BrandingProvider,DEFAULT_BRANDING} from './brand';
import {api} from './api';
afterEach(()=>{cleanup();vi.restoreAllMocks()});
it('uses the official glass layout by default',()=>{
 vi.spyOn(api,'get').mockResolvedValue({providers:[],enabled:false});
 const {container}=render(<LoginScreen onLogin={()=>{}} />);
 expect(container.querySelector('main')).toHaveClass('glass-login');
});
it('selects a random background once and falls back on image failure',()=>{
 vi.spyOn(api,'get').mockResolvedValue({providers:[],enabled:false});
 const branding={...DEFAULT_BRANDING,login_background_mode:'random',login_background_urls:['https://images.example/one.jpg','https://images.example/two.jpg']};
 const view=render(<BrandingProvider branding={branding}><LoginScreen onLogin={()=>{}} /></BrandingProvider>);
 const image=view.container.querySelector('.login-background-image')!;
 const source=image.getAttribute('src');expect(source).toMatch(/^https:\/\/images.example\/(one|two)\.jpg\?_bg=\d+$/);
 fireEvent.change(view.container.querySelector('input[autocomplete=username]')!,{target:{value:'example'}});
 expect(image.getAttribute('src')).toBe(source);
 fireEvent.error(image);expect(view.container.querySelector('.login-background-image')).toBeNull();
 expect(view.container.querySelector('main')).not.toHaveClass('has-login-background');
});
